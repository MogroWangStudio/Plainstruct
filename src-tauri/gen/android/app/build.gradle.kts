import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// 发布签名读取 gen/android/keystore.properties(git 忽略;本地生成或由 CI 从
// ANDROID_RELEASE_KEYSTORE_* secrets 解出)。四项缺一不可 —— 只判断「文件是否存在」
// 会让半配置的密钥一路走到打包阶段才报看不懂的错。
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.isFile) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}
val keystoreRequiredKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val keystoreConfigured = keystorePropertiesFile.isFile &&
    keystoreRequiredKeys.all { !keystoreProperties.getProperty(it).isNullOrBlank() }

// 只在显式开启时允许用 debug 密钥签名。CI 上静默回退是「每次构建签名都不一样」的
// 直接原因:debug.keystore 在全新 runner 上由构建工具现生成,密钥对每次随机。
// 因此这里 fail-closed —— 没有正式密钥就报错,而不是产出一个装不上去的 APK。
val allowDebugSigning = (System.getenv("PLAINSTRUCT_ALLOW_DEBUG_SIGNING") ?: "")
    .lowercase() in setOf("1", "true", "yes")
val ciRun = !System.getenv("CI").isNullOrBlank()

if (keystorePropertiesFile.isFile && !keystoreConfigured) {
    throw GradleException(
        "keystore.properties 存在但缺少 ${keystoreRequiredKeys.joinToString(" / ")} 中的字段," +
            "拒绝用半配置的密钥签名。请重新生成(scripts/android-signing.sh gen-keystore)。"
    )
}
if (keystoreConfigured && !rootProject.file(keystoreProperties.getProperty("storeFile")).isFile) {
    throw GradleException(
        "keystore.properties 指向的密钥文件不存在:" +
            rootProject.file(keystoreProperties.getProperty("storeFile")).absolutePath
    )
}
if (!keystoreConfigured) {
    if (ciRun && !allowDebugSigning) {
        throw GradleException(
            "未配置发布签名:keystore.properties 缺失。CI 不再回退到临时 debug 密钥" +
                "(每次构建会生成不同密钥,APK 无法覆盖升级)。请配置 secrets " +
                "ANDROID_RELEASE_KEYSTORE_B64 / ANDROID_RELEASE_KEYSTORE_PASSWORD;" +
                "若确实只想产出一次性验证包,显式设置 PLAINSTRUCT_ALLOW_DEBUG_SIGNING=1。"
        )
    }
    logger.warn(
        "未配置发布签名,release 构建将使用本机 debug 密钥 —— 仅限本机调试," +
            "产物无法覆盖安装已发布的版本。"
    )
}

android {
    compileSdk = 36
    namespace = "com.mws.plainstruct"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.mws.plainstruct"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (keystoreConfigured) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                // 显式声明签名方案:minSdk 24 起不需要 v1(JAR),v2 保证 7.0+ 校验,
                // v3 为将来换密钥(密钥轮换)留出通道。方案固定,避免 AGP 默认值随
                // 版本漂移导致「同一密钥签出的产物结构不同」。
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            signingConfig = if (keystoreConfigured) {
                signingConfigs.getByName("release")
            } else {
                // 仅本机调试路径会走到这里:CI 上缺密钥已在配置阶段直接失败。
                signingConfigs.getByName("debug")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")