import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UninstallButtonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const configPath = this.dir.get_path() + '/config.json';
        
        let currentLang = 'zh_CN';
        let currentStyle = 'rich';
        try {
            if (Gio.File.new_for_path(configPath).query_exists(null)) {
                const [ok, content] = Gio.File.new_for_path(configPath).load_contents(null);
                if (ok) {
                    const config = JSON.parse(new TextDecoder().decode(content));
                    if (config.language) currentLang = config.language;
                    if (config.style) currentStyle = config.style;
                }
            }
        } catch (e) {
            logError(e, 'Failed to read config.json');
        }

        const page = new Adw.PreferencesPage({
            title: currentLang === 'zh_CN' ? '设置' : 'Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: currentLang === 'zh_CN' ? '个性化配置' : 'Personalization',
        });
        page.add(group);

        const langList = Gtk.StringList.new(['简体中文', 'English']);
        const langRow = new Adw.ComboRow({
            title: currentLang === 'zh_CN' ? '显示语言' : 'Language',
            model: langList,
        });
        langRow.selected = currentLang === 'zh_CN' ? 0 : 1;

        const styleMap = ['rich', 'simple', 'minimal', 'package_only'];
        const styleListZH = ['丰富', '简约', '最小', '包名'];
        const styleListEN = ['Rich', 'Simple', 'Minimal', 'Package Only'];
        
        const styleStringList = Gtk.StringList.new(currentLang === 'zh_CN' ? styleListZH : styleListEN);
        const styleRow = new Adw.ComboRow({
            title: currentLang === 'zh_CN' ? '对话框样式' : 'Dialog Style',
            model: styleStringList,
        });
        
        let styleIndex = styleMap.indexOf(currentStyle);
        styleRow.selected = styleIndex !== -1 ? styleIndex : 0;

        const saveConfig = (lang, style) => {
            try {
                const configData = JSON.stringify({ language: lang, style: style }, null, 4);
                const file = Gio.File.new_for_path(configPath);
                file.replace_contents(
                    new TextEncoder().encode(configData),
                    null,
                    false,
                    Gio.FileCreateFlags.NONE,
                    null
                );
            } catch (e) {
                logError(e, 'Failed to write config.json');
            }
        };

        langRow.connect('notify::selected', () => {
            const selectedLang = langRow.selected === 0 ? 'zh_CN' : 'en_US';
            const selectedStyle = styleMap[styleRow.selected] || 'rich';
            
            saveConfig(selectedLang, selectedStyle);

            if (selectedLang === 'zh_CN') {
                page.title = '设置';
                group.title = '个性化配置';
                langRow.title = '显示语言';
                styleRow.title = '对话框样式';
                styleStringList.splice(0, 4);
                styleListZH.forEach(s => styleStringList.append(s));
            } else {
                page.title = 'Settings';
                group.title = 'Personalization';
                langRow.title = 'Language';
                styleRow.title = 'Dialog Style';
                styleStringList.splice(0, 4);
                styleListEN.forEach(s => styleStringList.append(s));
            }
        });

        styleRow.connect('notify::selected', () => {
            const selectedLang = langRow.selected === 0 ? 'zh_CN' : 'en_US';
            const selectedStyle = styleMap[styleRow.selected] || 'rich';
            saveConfig(selectedLang, selectedStyle);
        });

        group.add(langRow);
        group.add(styleRow);
    }
}