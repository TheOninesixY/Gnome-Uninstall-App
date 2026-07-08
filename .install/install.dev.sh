echo "正在安装开发版..."
rm -f ./uninstall-app@oninesixy.zip
zip -r ./uninstall-app@oninesixy.zip ../uninstall-app@oninesixy
gnome-extensions install ./uninstall-app@oninesixy.zip