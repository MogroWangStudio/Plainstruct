#!/bin/bash
# 素构 Plainstruct —— 损坏修复
# 双击运行,按提示输入开机密码(仅用于提权执行 xattr),
# 移除 macOS 对本磁盘镜像内 Plainstruct.app 的「隔离」标记,
# 之后拖入「应用程序」即可正常打开。

set -e

APP_NAME="Plainstruct.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$SCRIPT_DIR/$APP_NAME"

echo "=================================================="
echo "  素构 Plainstruct —— 损坏修复"
echo "=================================================="
echo
echo "本应用为开源软件:https://github.com/MogroWang/Plainstruct"
echo "全部源码公开,任何人都可审查与构建。"
echo
echo "由于应用未经 Apple 公证,从网络下载后 macOS 会为其附加"
echo "「隔离」标记,首次打开时可能提示:"
echo "「已损坏,无法打开,建议将它移到废纸篓」。"
echo
echo "本脚本只做一件事:移除该隔离标记,使软件能够正常启动。"
echo "它不会修改应用的任何内容,移除后应用可正常使用与卸载。"
echo
if [ ! -d "$APP_PATH" ]; then
  echo "未找到 $APP_NAME —— 请从挂载的安装镜像内运行本脚本。"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi
echo "即将处理的应用:"
echo "  $APP_PATH"
echo "将执行的命令:"
echo "  sudo xattr -r -d com.apple.quarantine \"$APP_NAME\""
echo "执行时需要输入开机密码提权(输入时屏幕不显示,属正常现象)。"
echo
sudo xattr -r -d com.apple.quarantine "$APP_PATH"
echo
echo "完成!现在可以关闭本窗口,把 $APP_NAME 拖入「应用程序」,"
echo "即可直接打开,不再出现「已损坏」提示。"
echo
read -r -p "按回车键退出..."
