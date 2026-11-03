# 安卓构建签名一致性:根因与修复

本文说明「同一版本多次构建,APK 签名为什么每次都不一样」的成因、本次修复做了什么,
以及如何验证修复确实生效。相关代码:

| 位置 | 作用 |
| --- | --- |
| `.github/workflows/ci.yml`(`android-apk` job) | 密钥注入、指纹比对、产物验签、留档 |
| `src-tauri/gen/android/app/build.gradle.kts` | 签名配置严格校验、禁止静默回退 debug |
| `scripts/android-signing.sh` | 生成密钥 / 读取指纹 / 写入基线 / 校验产物 |
| `src-tauri/gen/android/android-cert-sha256.txt` | 证书指纹基线(跨构建判定的唯一依据) |

---

## 一、结论先行

**签名不是一个固定值,而是「用哪把私钥签」的结果。** 只要每次构建拿到的私钥不同,
签名必然不同 —— 这与打包工具、Gradle 版本、压缩算法都无关。

排查确认:本项目此前的 CI 在**没有正式密钥时会静默回退到 runner 临时的 debug 密钥**,
而 GitHub 托管的 runner 每次都是全新虚拟机,`~/.android/debug.keystore` 不存在时由构建
工具**现场随机生成**。于是每次构建都是「新密钥 → 新证书 → 新签名」,表现就是:

- 每次产出的 APK 证书指纹都不同;
- 手机上升级安装报「签名不一致 / 应用未安装」;
- 每个新版本在系统眼里都像一个全新的应用(无法继承原有数据与权限)。

## 二、根因链

签名不固定不是一个 bug,而是四个环节叠加的结果:

### 1. 签名配置只判断「文件存不存在」

原 `build.gradle.kts`:

```kotlin
if (keystorePropertiesFile.exists()) { ... create("release") { ... } }
...
signingConfig = if (keystorePropertiesFile.exists()) release else signingConfigs.getByName("debug")
```

只要 `keystore.properties` 不在,release 构建就**无声地**改用 `debug` 签名配置。
配置本身没有错,错在「静默」:流水线不会因此变红,只会稳定地产出装不上去的包。

### 2. CI 提供了同一条静默回退路径

原 workflow 的 `Restore release keystore` 在 secrets 缺失时只 `::warning::`,不失败:

```yaml
else
  echo "signed=false" >> "$GITHUB_OUTPUT"
  echo "::warning::Secrets ... are not set. Falling back to the runner's ephemeral debug key"
```

### 3. debug 密钥在 runner 上是「一次性的」

AGP 的 `debug` 签名指向 `$HOME/.android/debug.keystore`,缺失时由 SDK 现场生成一对随机
RSA 密钥。实测(同一 DN、同样参数、两次独立生成):

```
DN 相同 → SHA-256: 90:EC:F6:C6:...:10:B5
DN 相同 → SHA-256: 8E:38:D0:EA:...:BF:00
```

证书主体一模一样,**公钥完全不同** —— 指纹自然不同。这就是「每次构建签名都变」的物理来源。
本机仓库里那份 2026-10-28 的 APK 也验证了同一现象:签发给 `CN=Android Debug`,
指纹 `992fc5b0…6983`,与本机 `~/.android/debug.keystore` 一致 —— 它从来不是发布密钥。

### 4. 签名算法本身是确定性的(排除误判)

为排除「apksigner 每次签出不同结果」这一可能,做了对照实验:用**同一把** 4096 位 RSA
密钥、对**同一份** APK 连续签两次:

```
c91b6d7c…196a  s1.apk
c91b6d7c…196a  s2.apk   ← 字节完全一致
```

RSA(PKCS#1 v1.5)签名是确定性的,只有 ECDSA 才需要随机数。**所以问题 100% 在密钥,
不在签名算法或打包工具。**

### 5. 附带的不确定源(会让「同一密钥」也产出不同字节,但不影响证书)

- 原收集步骤 `find ... -path "*release*" | head -n 1`:一次构建产出多个 apk 时,
  取哪个取决于文件系统遍历顺序;
- Rust/NDK 产物会嵌入构建路径、增量编译状态,导致 `.so` 字节不同 → APK 哈希不同;
- macOS 是 ad-hoc 签名(`codesign --sign -`),没有身份可言,内容一变 cdhash 就变;
  Windows 产物未做 Authenticode。这两端**不存在**可固定到某个证书的签名身份。

## 三、修复内容

### 1. CI 改为 fail-closed(核心)

`android-apk` job 的 `Restore release keystore`:

- secrets 缺失 → **直接失败**,并给出可执行的错误信息(生成密钥的文档入口);
- 只有仓库变量 `ANDROID_ALLOW_DEBUG_SIGNING=true` 才允许降级为临时包,且带显著告警;
  该开关在 gradle 侧对应 `PLAINSTRUCT_ALLOW_DEBUG_SIGNING=1`(gradle 对「CI 环境 +
  无正式密钥」是 fail-closed 的),CI 在降级路径上会自动透传,本机构建时手动设置即可;
- 解出密钥后立即 `keytool -list` 试开一次 —— 密码错、别名错在交叉编译**之前**就报错;
- 密钥与 `keystore.properties` 都 `chmod 600`,job 结束（`if: always()`）立即删除。

### 2. 构建前先核对「密钥 ↔ 基线」

新增 `Check keystore against committed fingerprint baseline`:把 secrets 里那把密钥的
证书指纹,与仓库基线 `android-cert-sha256.txt` 比对。不一致即失败。

这一层拦住的是另一种事故:**悄悄换了密钥却没有同步基线** —— 此时构建能成功,
但产物已经和线上版本不是同一身份了。

### 3. 构建后强制验签

`Verify apk signature against baseline` 调用 `scripts/android-signing.sh verify-apk`,
检查三件事:

1. 签名有效、签名者数量为 1;
2. 使用了 v2 或 v3 签名方案(v1/JAR 已不适用于 `minSdk 24`);
3. **证书指纹与基线逐字节相等**(`--require-pin` 保证基线缺失时也算失败)。

任一不满足 → job 失败,不产出发布件。同时生成 `signing-report.json` 与 `SHA256SUMS.txt`
作为 Artifact 留档。

### 4. Gradle 侧收紧

- `keystore.properties` 的四个字段(`storeFile/storePassword/keyAlias/keyPassword`)
  缺一即报错,不再「文件在就算配好」;
- `storeFile` 指向的文件必须真实存在;
- `CI=true` 且无正式密钥 → 配置阶段直接抛异常(与本机开发区分:本机只告警);
- 显式声明签名方案 `v1=false / v2=true / v3=true / v4=false`,避免 AGP 默认值随版本漂移;
- 修复 `packaging {` 与 `jniLibs.keepDebugSymbols` 挤在同一行的格式问题。

### 5. 产物挑选确定化

固定优先级 `arm64 → universal → aarch64`,再退回 `find | sort | head -1`,
并校验 APK 内确实含 `lib/arm64-v8a/`。同一提交永远取同一个文件。

### 6. 密钥不入库

`.gitignore` 增加 `*.keystore / *.jks / *.p12 / keystore.b64`。此前
`plainstruct-release.keystore`(CI 解出物)并不在忽略列表里,存在误提交风险。

## 四、一次性配置(维护者执行)

```bash
# 1. 生成发布密钥(仅一次;密码请让脚本生成并存进密码管理器)
./scripts/android-signing.sh gen-keystore \
    --out ~/plainstruct-release.p12 \
    --b64-out ~/plainstruct-release.b64
# 输出会打印别名、密码与证书 SHA-256

# 2. 写入指纹基线并提交(把打印出的 64 位指纹写进仓库)
KEYSTORE_PASSWORD='<上一步打印的密码>' \
  ./scripts/android-signing.sh pin --keystore ~/plainstruct-release.p12

# 3. 配置仓库 secrets
#    ANDROID_RELEASE_KEYSTORE_B64      ← ~/plainstruct-release.b64 的全文
#    ANDROID_RELEASE_KEYSTORE_PASSWORD ← 上一步的密码
#    可选 ANDROID_RELEASE_KEY_ALIAS(默认 plainstruct-release)

# 4. 提交基线文件
git add src-tauri/gen/android/android-cert-sha256.txt
git commit -m "chore(ci): 固定安卓发布签名指纹基线"
```

生成后请把 `.p12` 与密码**双备份**(离线介质 + 密码管理器)。密钥丢失等于永远无法
再发布可覆盖升级的版本,只能换包名重新上架。

## 五、验证步骤

### 1. CI 内自动验证(每次构建)

推送后检查 `android-apk` job:

- `Check keystore against committed fingerprint baseline` 通过 —— 密钥与基线一致;
- `Verify apk signature against baseline` 输出 `结果 : PASS`,且 `签名方案 : v1=false v2=true v3=true`;
- Artifact `plainstruct-android-signing-report` 内 `signing-report.json` 的
  `signerCertSha256` 等于基线值。

### 2. 跨构建比对(证明「不漂移」)

对同一版本(不动代码,重新触发 `workflow_dispatch` 两次),下载两次的 APK:

```bash
# 两次的证书指纹必须完全相同
./scripts/android-signing.sh fingerprint-apk Plainstruct_4.4.0_android.apk
```

更进一步:若两次的 `.so` 也一致(未受路径/增量影响),`sha256sum` 也应相同 ——
RSA 签名确定性保证了这一点。**判定标准以证书指纹为准,文件哈希为附加观察。**

### 3. 本地负向验证(证明红线真的会红)

```bash
# a) 用占位基线 + 强制要求基线 → 必须失败(退出码 1)
./scripts/android-signing.sh verify-apk app-universal-release.apk \
  --pin-file src-tauri/gen/android/android-cert-sha256.txt --require-pin

# b) 拿一份 debug 签名产物对正式基线 → 必须失败
./scripts/android-signing.sh verify-apk <旧临时包>.apk --pin-file /tmp/pin.txt

# c) 用正式密钥签同一份内容两次 → 哈希相同、指纹相同、校验 PASS
APKSIGNER=$(ls "$ANDROID_HOME"/build-tools/*/apksigner | tail -1)
cp base.apk x.apk && cp base.apk y.apk
for f in x y; do
  "$APKSIGNER" sign --ks release.p12 --ks-key-alias plainstruct-release \
    --ks-pass pass:'<密码>' --key-pass pass:'<密码>' \
    --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true "$f.apk"
done
shasum -a 256 x.apk y.apk    # 应完全一致
```

### 4. 真机升级验证(最终判据)

1. 装上一版 release APK;
2. 装本次构建的同包名 APK;
3. 应正常覆盖安装且数据保留。若提示「签名不一致」,说明两次构建的密钥不同 ——
   回到第 1 步检查 secrets 与基线。

### 5. 回归自检清单

- [ ] `keystore.properties` 四字段齐全(gradle 会报错提示)
- [ ] `ANDROID_RELEASE_KEYSTORE_*` 两个 secret 已配置
- [ ] `android-cert-sha256.txt` 不是 `UNSET`
- [ ] CI 日志中「密钥证书指纹」与「基线证书指纹」两行数值相同
- [ ] `signing-report.json` 的 `status` 为 `PASS`

## 六、密钥轮换

换密钥会让新包无法覆盖安装旧包(系统按签名判定应用身份)。确需轮换时:

1. **借助 v3 的密钥轮换通道**:v3 签名方案支持 `lineage`,可在保留旧密钥的情况下平滑换新
   (`apksigner rotate` 生成 lineage,再 `--lineage` 签名)。这是唯一「用户无感」的换钥方式。
2. **否则必须换包名 / 让用户卸载重装**:卸载会清空应用私有数据(站点内容),需先提示用户
   用「局域网同步」把站点传回电脑。
3. 轮换后同步更新 secrets 与 `android-cert-sha256.txt`,并在 changelog 中明确告知用户。

## 七、已知限制(诚实说明)

| 平台 | 签名身份 | 能否跨构建固定 |
| --- | --- | --- |
| Android APK | 仓库固定密钥(RSA 4096) | **能**,已由基线强制保证 |
| macOS dmg/zip | ad-hoc(`-`),无 Team ID | 不能。无 Apple 开发者证书就没有稳定身份,cdhash 随内容变化;本次仅保证签名**有效**并留档 cdhash |
| Windows zip/exe | 未签名 | 不能。无 Authenticode 证书;用户会见到 SmartScreen 提示 |

另外,APK **字节级**可复现属于附带目标而非承诺:`RUSTFLAGS`/NDK 会嵌入构建路径,
Gradle/R8 版本升级也可能改变输出。判定签名一致性以**证书指纹**为准 —— 这正是 Android
系统用来判断「能否覆盖安装」的依据。
