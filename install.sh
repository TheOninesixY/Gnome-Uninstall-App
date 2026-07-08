#!/bin/bash
echo "你想安装稳定版还是开发版？"
echo "（一般是装稳定版的）"
echo "输入 1 安装稳定版"
echo "输入 2 安装开发版"
read -rp "请选择: " choice
case "$choice" in
  1)
    echo "正在安装稳定版..."
    gnome-extensions install ./.releases/uninstall-app@oninesixy.zip
    gnome-extensions enable uninstall-app@oninesixy
    ;;
  2)
    echo "正在安装开发版..."
    bash ./.install/install.dev.sh
    gnome-extensions enable uninstall-app@oninesixy
    ;;
  *)
    echo "无效选项，请输入 1 或 2。"
    ;;
esac
