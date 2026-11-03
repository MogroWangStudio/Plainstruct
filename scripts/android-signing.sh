#!/usr/bin/env bash
# 素构 Plainstruct —— 安卓签名工具
#
# 为什么需要这个脚本:APK 的「签名」本质是「用哪把私钥签」,而不是一个固定值。
# 只要 CI 每次拿到的不是同一把密钥,产物签名就必然每次都变,表现就是无法覆盖升级。
# 因此这里把「生成密钥 → 记录证书指纹基线 → 校验产物」串成可复现的流程,
# 让签名一致性成为一条能自动判定通过 / 失败的红线。
#
# 子命令:
#   gen-keystore --out <路径> [--alias 别名] [--password 密码] [--dname DN] [--b64-out 文件]
#   fingerprint-keystore <keystore>
#   fingerprint-apk <apk>
#   pin --keystore <keystore> [--file 基线文件] [--alias 别名]
#   verify-apk <apk> [--expect <sha256>] [--pin-file <文件>] [--report <json>] [--require-pin]
#
# fingerprint-* / pin 从环境变量取密码与别名:KEYSTORE_PASSWORD / KEY_ALIAS,
# 避免密码进入 shell 历史。
#
# 依赖:keytool(JDK)、apksigner(Android SDK build-tools,可用 ANDROID_HOME 定位)。

set -euo pipefail

PROG=$(basename "$0")
DEFAULT_ALIAS="plainstruct-release"
DEFAULT_DNAME="CN=Plainstruct Release, O=MogroWang Studio, C=CN"
DEFAULT_PIN_FILE="src-tauri/gen/android/android-cert-sha256.txt"

die() {
  printf '%s: %s\n' "$PROG" "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

usage() {
  cat <<'EOF'
素构 Plainstruct —— 安卓签名工具

用法:
  android-signing.sh gen-keystore --out <路径> [--alias 别名] [--password 密码]
                                  [--dname DN] [--b64-out 文件] [--validity 天数]
  android-signing.sh fingerprint-keystore <keystore>
  android-signing.sh fingerprint-apk <apk>
  android-signing.sh pin --keystore <keystore> [--file 基线文件] [--alias 别名]
  android-signing.sh verify-apk <apk> [--expect <sha256>] [--pin-file <文件>]
                                  [--report <json>] [--require-pin]

环境变量:
  KEYSTORE_PASSWORD  密钥库密码(fingerprint-keystore / pin 必填)
  KEY_ALIAS          密钥别名,默认 plainstruct-release
  ANDROID_HOME       Android SDK 根目录,用于定位 apksigner
  APKSIGNER          直接指定 apksigner 路径(优先于 ANDROID_HOME)

退出码:
  0  校验通过(或仅有未设置基线的告警)
  1  校验失败:签名缺失 / 签名方案不合格 / 证书指纹与基线不一致
  2  用法错误
EOF
}

repo_root() {
  cd "$(dirname "$0")/.." && pwd
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# 取 SHA-256 指纹时不用 keytool 的标签文本(会被本地化),而是按「32 组十六进制」匹配:
# MD5 为 16 组、SHA-1 为 20 组,不会误匹配,中英文与任意 JDK 版本都能解析。
fingerprint_keystore() {
  local ks=$1 pw=${KEYSTORE_PASSWORD:-} alias=${KEY_ALIAS:-$DEFAULT_ALIAS} out fp
  if [ ! -f "$ks" ]; then
    die "密钥文件不存在:$ks"
  fi
  if [ -z "$pw" ]; then
    die "请用环境变量提供密码:KEYSTORE_PASSWORD=... $PROG fingerprint-keystore $ks"
  fi
  if ! out=$(keytool -list -v -keystore "$ks" -storepass "$pw" -alias "$alias" 2>&1); then
    die "读取密钥失败(密码或别名 [$alias] 不正确):$(printf '%s' "$out" | tr '\n' ' ')"
  fi
  fp=$(printf '%s\n' "$out" | grep -oiE '([0-9a-f]{2}:){31}[0-9a-f]{2}' | head -n 1 | tr -d ':' | tr 'A-F' 'a-f' || true)
  if [ ${#fp} -ne 64 ]; then
    die "无法从 keytool 输出中解析出 SHA-256 指纹"
  fi
  printf '%s\n' "$fp"
}

find_apksigner() {
  if [ -n "${APKSIGNER:-}" ]; then
    if [ -x "${APKSIGNER}" ]; then
      printf '%s\n' "${APKSIGNER}"
      return 0
    fi
    die "APKSIGNER 指向的文件不可执行:${APKSIGNER}"
  fi
  local cand
  cand=$(command -v apksigner 2>/dev/null || true)
  if [ -n "$cand" ]; then
    printf '%s\n' "$cand"
    return 0
  fi
  local root best bestkey dir ver key
  for root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /usr/local/lib/android/sdk; do
    if [ -z "$root" ] || [ ! -d "$root/build-tools" ]; then
      continue
    fi
    best=""
    bestkey=""
    for dir in "$root"/build-tools/*; do
      if [ ! -x "$dir/apksigner" ]; then
        continue
      fi
      ver=${dir##*/}
      # 版本号补零后按字符串比较,兼容没有 sort -V 的 macOS
      key=$(printf '%s' "$ver" | awk -F. '{printf "%05d%05d%05d", $1, $2, $3}')
      if [ -z "$bestkey" ] || [ "$key" \> "$bestkey" ]; then
        best="$dir/apksigner"
        bestkey="$key"
      fi
    done
    if [ -n "$best" ]; then
      printf '%s\n' "$best"
      return 0
    fi
  done
  return 1
}

apksigner_output() {
  local apk=$1 signer
  if ! signer=$(find_apksigner); then
    die "找不到 apksigner:请安装 Android SDK build-tools 或设置 ANDROID_HOME / APKSIGNER"
  fi
  # 验签失败时 apksigner 返回非 0,这里必须与「工具缺失」区分开
  if ! "$signer" verify --verbose --print-certs "$apk" 2>/dev/null; then
    die "apksigner 校验未通过:APK 未签名或签名已损坏($apk)"
  fi
}

scheme_state() {
  # $1 = v1/v2/v3, $2 = apksigner 输出;返回 true / false / unknown
  local state
  state=$(printf '%s\n' "$2" | grep -F "Verified using $1 scheme" | sed 's/.*): *//' | head -n 1 || true)
  printf '%s\n' "${state:-unknown}"
}

cmd_fingerprint_keystore() {
  if [ $# -lt 1 ]; then
    die "用法:$PROG fingerprint-keystore <keystore>"
  fi
  fingerprint_keystore "$1"
}

cmd_fingerprint_apk() {
  if [ $# -lt 1 ]; then
    die "用法:$PROG fingerprint-apk <apk>"
  fi
  local apk=$1 out fp
  if [ ! -f "$apk" ]; then
    die "APK 不存在:$apk"
  fi
  out=$(apksigner_output "$apk")
  fp=$(printf '%s\n' "$out" | grep -i 'certificate SHA-256 digest' | grep -oiE '[0-9a-f]{64}' | head -n 1 | tr 'A-F' 'a-f' || true)
  if [ ${#fp} -ne 64 ]; then
    die "无法从 apksigner 输出解析证书指纹"
  fi
  printf '%s\n' "$fp"
}

cmd_gen_keystore() {
  local out="" alias=$DEFAULT_ALIAS pw="" dname=$DEFAULT_DNAME b64out="" validity=10000
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) out=${2:-}; shift 2 ;;
      --alias) alias=${2:-}; shift 2 ;;
      --password) pw=${2:-}; shift 2 ;;
      --dname) dname=${2:-}; shift 2 ;;
      --b64-out) b64out=${2:-}; shift 2 ;;
      --validity) validity=${2:-}; shift 2 ;;
      *) die "未知参数:$1" ;;
    esac
  done
  if [ -z "$out" ]; then
    die "用法:$PROG gen-keystore --out <路径> [--alias ...] [--password ...]"
  fi
  if [ -f "$out" ]; then
    die "目标已存在,拒绝覆盖 —— 换密钥会让已发布版本无法升级:$out"
  fi

  if [ -z "$pw" ]; then
    if command -v openssl >/dev/null 2>&1; then
      pw=$(openssl rand -base64 24 | tr -d '\n=+/')
    else
      pw=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    fi
  fi
  if [ ${#pw} -lt 12 ]; then
    die "密码太短,至少 12 位"
  fi

  mkdir -p "$(dirname "$out")"
  # PKCS12 + RSA 4096 + 10000 天:签名证书长期有效,避免因证书过期导致验签失败。
  # RSA(PKCS#1 v1.5)签名是确定性的 —— 同一把密钥签同一份内容,产物字节完全一致。
  if ! keytool -genkeypair -keystore "$out" -storetype PKCS12 -alias "$alias" \
    -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity "$validity" \
    -storepass "$pw" -keypass "$pw" -dname "$dname" >/dev/null 2>&1; then
    die "生成密钥失败"
  fi
  chmod 600 "$out"

  local fp
  fp=$(KEYSTORE_PASSWORD="$pw" KEY_ALIAS="$alias" fingerprint_keystore "$out")
  info "密钥已生成:$out"
  info "别名:$alias"
  info "密码:$pw   ← 立即存入密码管理器;丢失后无法再签出可覆盖升级的版本"
  info "证书 SHA-256:$fp"

  if [ -n "$b64out" ]; then
    mkdir -p "$(dirname "$b64out")"
    if command -v openssl >/dev/null 2>&1; then
      openssl base64 -A -in "$out" -out "$b64out"
    else
      base64 <"$out" | tr -d '\n' >"$b64out"
    fi
    info "Base64 已写入:$b64out"
    info "  → 全文存入仓库 secret ANDROID_RELEASE_KEYSTORE_B64"
  fi
  info ""
  info "下一步:"
  info "  1. 密码存入仓库 secret ANDROID_RELEASE_KEYSTORE_PASSWORD"
  info "  2. 写入证书指纹基线并提交:"
  info "     KEYSTORE_PASSWORD=*** $PROG pin --keystore $out --alias $alias"
}

cmd_pin() {
  local ks="" file="$DEFAULT_PIN_FILE" alias=${KEY_ALIAS:-$DEFAULT_ALIAS}
  while [ $# -gt 0 ]; do
    case "$1" in
      --keystore) ks=${2:-}; shift 2 ;;
      --file) file=${2:-}; shift 2 ;;
      --alias) alias=${2:-}; shift 2 ;;
      *) die "未知参数:$1" ;;
    esac
  done
  if [ -z "$ks" ]; then
    die "用法:$PROG pin --keystore <keystore> [--file 基线文件]"
  fi
  local fp root
  fp=$(KEY_ALIAS="$alias" fingerprint_keystore "$ks")
  root=$(repo_root)
  case "$file" in
    /*) : ;;
    *) file="$root/$file" ;;
  esac
  mkdir -p "$(dirname "$file")"
  cat >"$file" <<EOF
# 素构 Plainstruct —— APK 签名证书基线(SHA-256,小写十六进制)
#
# 由 scripts/android-signing.sh pin 生成;CI 用它判定「本次产物是否由同一把密钥签发」。
# 这一行一旦变化,已发布版本就无法覆盖升级 —— 除非是计划内的密钥轮换
# (见 docs/android-signing.md),否则不要改。
$fp
EOF
  info "已写入指纹基线:$file"
  info "SHA-256:$fp"
}

read_pin() {
  # 输出基线中的指纹;未设置(缺失 / 占位)时输出空串
  local file=$1 fp
  if [ ! -f "$file" ]; then
    return 0
  fi
  fp=$(grep -oiE '[0-9a-f]{64}' "$file" | head -n 1 | tr 'A-F' 'a-f' || true)
  if [ ${#fp} -eq 64 ]; then
    printf '%s\n' "$fp"
  fi
  return 0
}

cmd_verify_apk() {
  local apk="" expect="" pinfile="" report="" require_pin=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --expect) expect=${2:-}; shift 2 ;;
      --pin-file) pinfile=${2:-}; shift 2 ;;
      --report) report=${2:-}; shift 2 ;;
      --require-pin) require_pin=1; shift ;;
      -*) die "未知参数:$1" ;;
      *) apk=$1; shift ;;
    esac
  done
  if [ -z "$apk" ]; then
    die "用法:$PROG verify-apk <apk> [--expect <sha256>] [--pin-file <文件>] [--report <json>] [--require-pin]"
  fi
  if [ ! -f "$apk" ]; then
    die "APK 不存在:$apk"
  fi

  local out cert v1 v2 v3 signers filehash expected="" pin_source="none"
  out=$(apksigner_output "$apk")

  cert=$(printf '%s\n' "$out" | grep -i 'certificate SHA-256 digest' | grep -oiE '[0-9a-f]{64}' | head -n 1 | tr 'A-F' 'a-f' || true)
  if [ ${#cert} -ne 64 ]; then
    die "无法解析签名证书指纹"
  fi
  v1=$(scheme_state v1 "$out")
  v2=$(scheme_state v2 "$out")
  v3=$(scheme_state v3 "$out")
  signers=$(printf '%s\n' "$out" | sed -n 's/^Number of signers: *//p' | head -n 1 || true)
  signers=${signers:-0}
  filehash=$(sha256_file "$apk")

  if [ -n "$expect" ]; then
    expected=$(printf '%s' "$expect" | tr -d ':' | tr 'A-F' 'a-f' | tr -d '[:space:]')
    pin_source="命令行 --expect"
  elif [ -n "$pinfile" ]; then
    expected=$(read_pin "$pinfile")
    pin_source="基线文件 $pinfile"
  fi

  local status="PASS" reason=""
  if [ "$signers" != "1" ]; then
    status="FAIL"
    reason="签名者数量为 $signers,应为 1"
  elif [ "$v2" != "true" ] && [ "$v3" != "true" ]; then
    status="FAIL"
    reason="未采用 v2/v3 签名方案(v2=$v2 v3=$v3)"
  elif [ ${#expected} -gt 0 ] && [ "$expected" != "$cert" ]; then
    status="FAIL"
    reason="证书指纹与基线不一致:产物不是由基线密钥签发"
  elif [ ${#expected} -eq 0 ] && [ "$require_pin" -eq 1 ]; then
    status="FAIL"
    reason="缺少证书指纹基线(--require-pin)"
  elif [ ${#expected} -eq 0 ]; then
    status="WARN"
    reason="未提供指纹基线,只校验了签名有效性"
  fi

  info "APK              : $apk"
  info "文件 SHA-256     : $filehash"
  info "签名证书 SHA-256 : $cert"
  info "签名方案         : v1=$v1 v2=$v2 v3=$v3,签名者=$signers"
  info "指纹基线         : ${expected:-未设置}($pin_source)"
  if [ -n "$reason" ]; then
    info "结果             : $status —— $reason"
  else
    info "结果             : $status"
  fi

  if [ -n "$report" ]; then
    mkdir -p "$(dirname "$report")"
    cat >"$report" <<EOF
{
  "apk": "$(basename "$apk")",
  "sha256": "$filehash",
  "sizeBytes": $(wc -c <"$apk" | tr -d ' '),
  "signerCertSha256": "$cert",
  "signingSchemes": { "v1": "$v1", "v2": "$v2", "v3": "$v3" },
  "signers": $signers,
  "expectedCertSha256": "$expected",
  "pinSource": "$pin_source",
  "status": "$status",
  "reason": "$reason",
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    info "报告             : $report"
  fi

  if [ "$status" = "FAIL" ]; then
    exit 1
  fi
  return 0
}

main() {
  if [ $# -lt 1 ]; then
    usage
    exit 2
  fi
  local cmd=$1
  shift
  case "$cmd" in
    gen-keystore) cmd_gen_keystore "$@" ;;
    fingerprint-keystore) cmd_fingerprint_keystore "$@" ;;
    fingerprint-apk) cmd_fingerprint_apk "$@" ;;
    pin) cmd_pin "$@" ;;
    verify-apk) cmd_verify_apk "$@" ;;
    -h | --help | help) usage ;;
    *) die "未知子命令:$cmd(可用:gen-keystore / fingerprint-keystore / fingerprint-apk / pin / verify-apk)" ;;
  esac
}

main "$@"
