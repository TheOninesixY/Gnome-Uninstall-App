import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function readConfig(configPath) {
    let config = { language: 'zh_CN', style: 'rich', 'diy-language': {} };
    try {
        if (Gio.File.new_for_path(configPath).query_exists(null)) {
            const [ok, content] = Gio.File.new_for_path(configPath).load_contents(null);
            if (ok) {
                const parsed = JSON.parse(new TextDecoder().decode(content));
                if (parsed.language) config.language = parsed.language;
                if (parsed.style) config.style = parsed.style;
                if (parsed['diy-language'] && typeof parsed['diy-language'] === 'object') {
                    config['diy-language'] = parsed['diy-language'];
                }
            }
        }
    } catch (e) {
        logError(e, 'Failed to read config.json');
    }
    return config;
}

function saveConfig(configPath, configData) {
    try {
        const file = Gio.File.new_for_path(configPath);
        file.replace_contents(
            new TextEncoder().encode(JSON.stringify(configData, null, 4)),
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null
        );
        return true;
    } catch (e) {
        logError(e, 'Failed to write config.json');
        return false;
    }
}

export default class UninstallButtonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const configPath = this.dir.get_path() + '/config.json';
        const initialConfig = readConfig(configPath);

        let currentLang = initialConfig.language;
        let currentStyle = initialConfig.style;
        let currentUiLang = currentLang === 'en_US' ? 'en_US' : 'zh_CN';

        const page = new Adw.PreferencesPage({
            title: currentUiLang === 'zh_CN' ? '设置' : 'Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: currentUiLang === 'zh_CN' ? '个性化配置' : 'Personalization',
        });
        page.add(group);

        const langList = Gtk.StringList.new(['简体中文', 'English', 'DIY']);
        const langRow = new Adw.ComboRow({
            title: currentUiLang === 'zh_CN' ? '显示语言' : 'Language',
            model: langList,
        });
        langRow.selected = currentLang === 'zh_CN' ? 0 : currentLang === 'en_US' ? 1 : 2;

        const styleMap = ['rich', 'simple', 'minimal', 'package_only'];
        const styleListZH = ['丰富', '简约', '最小', '包名'];
        const styleListEN = ['Rich', 'Simple', 'Minimal', 'Package Only'];

        const styleStringList = Gtk.StringList.new(currentUiLang === 'zh_CN' ? styleListZH : styleListEN);
        const styleRow = new Adw.ComboRow({
            title: currentUiLang === 'zh_CN' ? '对话框样式' : 'Dialog Style',
            model: styleStringList,
        });

        let styleIndex = styleMap.indexOf(currentStyle);
        styleRow.selected = styleIndex !== -1 ? styleIndex : 0;

        const diyRow = new Adw.ActionRow({
            title: currentUiLang === 'zh_CN' ? 'DIY 文案' : 'DIY Text',
            subtitle: currentUiLang === 'zh_CN' ? '编辑与刷新自定义文本' : 'Edit and refresh custom text',
        });
        const diyButtonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            halign: Gtk.Align.END,
        });
        const editButton = new Gtk.Button({
            label: currentUiLang === 'zh_CN' ? '编辑' : 'Edit',
            valign: Gtk.Align.CENTER,
        });
        const refreshButton = new Gtk.Button({
            label: currentUiLang === 'zh_CN' ? '刷新' : 'Refresh',
            valign: Gtk.Align.CENTER,
        });
        editButton.get_style_context().add_class('suggested-action');
        editButton.set_size_request(-1, 28);
        refreshButton.set_size_request(-1, 28);
        diyButtonBox.append(editButton);
        diyButtonBox.append(refreshButton);
        diyRow.add_suffix(diyButtonBox);
        diyRow.visible = currentLang === 'DIY';

        const updateUiTexts = (uiLang) => {
            if (uiLang === 'en_US') {
                page.title = 'Settings';
                group.title = 'Personalization';
                langRow.title = 'Language';
                styleRow.title = 'Dialog Style';
                styleStringList.splice(0, 4);
                styleListEN.forEach(item => styleStringList.append(item));
                editButton.label = 'Edit';
                refreshButton.label = 'Refresh';
                diyRow.title = 'DIY Text';
                diyRow.subtitle = 'Edit and refresh custom text';
            } else {
                page.title = '设置';
                group.title = '个性化配置';
                langRow.title = '显示语言';
                styleRow.title = '对话框样式';
                styleStringList.splice(0, 4);
                styleListZH.forEach(item => styleStringList.append(item));
                editButton.label = '编辑';
                refreshButton.label = '刷新';
                diyRow.title = 'DIY 文案';
                diyRow.subtitle = '编辑与刷新自定义文本';
            }
        };

        const applyConfig = (selectedLang, selectedStyle) => {
            const configData = readConfig(configPath);
            configData.language = selectedLang;
            configData.style = selectedStyle;
            saveConfig(configPath, configData);
            currentLang = selectedLang;
            currentStyle = selectedStyle;
            currentUiLang = selectedLang === 'en_US' ? 'en_US' : 'zh_CN';
            diyRow.visible = selectedLang === 'DIY';
            updateUiTexts(currentUiLang);
        };

        editButton.connect('clicked', () => {
            try {
                const command = `xdg-open ${GLib.shell_quote(configPath)}`;
                GLib.spawn_command_line_async(command);
            } catch (e) {
                logError(e, 'Failed to open config.json');
            }
        });

        refreshButton.connect('clicked', () => {
            const config = readConfig(configPath);
            currentLang = config.language;
            currentStyle = config.style;
            currentUiLang = currentLang === 'en_US' ? 'en_US' : 'zh_CN';
            diyRow.visible = currentLang === 'DIY';
            updateUiTexts(currentUiLang);
            langRow.selected = currentLang === 'zh_CN' ? 0 : currentLang === 'en_US' ? 1 : 2;
            styleRow.selected = styleMap.indexOf(currentStyle) !== -1 ? styleMap.indexOf(currentStyle) : 0;
        });

        langRow.connect('notify::selected', () => {
            const selectedLang = langRow.selected === 0 ? 'zh_CN' : langRow.selected === 1 ? 'en_US' : 'DIY';
            const selectedStyle = styleMap[styleRow.selected] || 'rich';
            applyConfig(selectedLang, selectedStyle);
        });

        styleRow.connect('notify::selected', () => {
            const selectedLang = langRow.selected === 0 ? 'zh_CN' : langRow.selected === 1 ? 'en_US' : 'DIY';
            const selectedStyle = styleMap[styleRow.selected] || 'rich';
            applyConfig(selectedLang, selectedStyle);
        });

        group.add(langRow);
        group.add(styleRow);
        group.add(diyRow);
    }
}