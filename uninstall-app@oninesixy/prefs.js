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
        let currentUiLang = currentLang === 'DIY' ? 'DIY' : currentLang === 'en_US' ? 'en_US' : 'zh_CN';

        const getLabel = (zh, en, lang = currentUiLang) => {
            if (lang === 'DIY')
                return `${zh} / ${en}`;
            return lang === 'en_US' ? en : zh;
        };

        const page = new Adw.PreferencesPage({
            title: getLabel('设置', 'Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: getLabel('个性化配置', 'Personalization'),
        });
        page.add(group);

        const langList = Gtk.StringList.new(['简体中文', 'English', 'DIY']);
        const langRow = new Adw.ComboRow({
            title: getLabel('显示语言', 'Language'),
            model: langList,
        });
        langRow.selected = currentLang === 'zh_CN' ? 0 : currentLang === 'en_US' ? 1 : 2;

        const styleMap = ['rich', 'simple', 'minimal', 'package_only'];
        const styleListZH = ['丰富', '简约', '最小', '包名'];
        const styleListEN = ['Rich', 'Simple', 'Minimal', 'Package Only'];

        const styleStringList = Gtk.StringList.new(currentUiLang === 'DIY'
            ? ['丰富 / Rich', '简约 / Simple', '最小 / Minimal', '包名 / Package Only']
            : currentUiLang === 'en_US' ? styleListEN : styleListZH);
        const styleRow = new Adw.ComboRow({
            title: getLabel('对话框样式', 'Dialog Style'),
            model: styleStringList,
        });

        let styleIndex = styleMap.indexOf(currentStyle);
        styleRow.selected = styleIndex !== -1 ? styleIndex : 0;

        const diyRow = new Adw.ActionRow({
            title: getLabel('DIY 文案', 'DIY Text'),
            subtitle: getLabel('编辑与刷新自定义文本', 'Edit and refresh custom text'),
        });
        const diyButtonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            halign: Gtk.Align.END,
        });
        const editButton = new Gtk.Button({
            label: getLabel('编辑', 'Edit'),
            valign: Gtk.Align.CENTER,
        });
        const refreshButton = new Gtk.Button({
            label: getLabel('刷新', 'Refresh'),
            valign: Gtk.Align.CENTER,
        });
        editButton.get_style_context().add_class('suggested-action');
        editButton.set_size_request(-1, 28);
        refreshButton.set_size_request(-1, 28);
        diyButtonBox.append(editButton);
        diyButtonBox.append(refreshButton);
        diyRow.add_suffix(diyButtonBox);
        diyRow.visible = currentLang === 'DIY';

        const diyFieldMeta = [
            { key: 'menu_uninstall', zh: '右键菜单文本', en: 'Context menu text' },
            { key: 'confirm_title', zh: '确认标题', en: 'Confirm title' },
            { key: 'confirm_prefix', zh: '确认前缀', en: 'Confirm prefix' },
            { key: 'cancel', zh: '取消按钮', en: 'Cancel button' },
            { key: 'retain_uninstall', zh: '保留数据卸载按钮', en: 'Keep data uninstall button' },
            { key: 'uninstall', zh: '卸载按钮', en: 'Uninstall button' },
            { key: 'unknown_app', zh: '未知应用提示', en: 'Unknown app text' },
        ];

        const showDiyEditor = () => {
            const dialog = new Gtk.Dialog({
                title: getLabel('编辑 DIY 文案', 'Edit DIY text'),
                transient_for: window,
                modal: true,
                use_header_bar: true,
            });

            const contentArea = dialog.get_content_area();
            const dialogBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            });

            const scrolled = new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
                min_content_height: 320,
                max_content_height: 480,
            });

            const group = new Adw.PreferencesGroup();
            const editorRows = [];
            const currentConfig = readConfig(configPath);
            const diyTexts = currentConfig['diy-language'] || {};

            diyFieldMeta.forEach(meta => {
                const row = new Adw.EntryRow({
                    title: `${meta.zh} / ${meta.en}`,
                    text: diyTexts[meta.key] || '',
                });
                group.add(row);
                editorRows.push(row);
            });

            scrolled.set_child(group);
            dialogBox.append(scrolled);
            contentArea.append(dialogBox);

            dialog.add_button(getLabel('取消', 'Cancel'), Gtk.ResponseType.CANCEL);
            dialog.add_button(getLabel('保存', 'Save'), Gtk.ResponseType.APPLY);
            dialog.set_default_response(Gtk.ResponseType.APPLY);

            dialog.connect('response', (dlg, responseId) => {
                if (responseId !== Gtk.ResponseType.APPLY) {
                    dlg.destroy();
                    return;
                }

                const configData = readConfig(configPath);
                const nextDiy = configData['diy-language'] || {};

                editorRows.forEach((row, index) => {
                    const meta = diyFieldMeta[index];
                    if (!meta)
                        return;

                    const value = row.text?.trim?.() || '';
                    if (value) {
                        nextDiy[meta.key] = value;
                    } else {
                        delete nextDiy[meta.key];
                    }
                });

                configData['diy-language'] = nextDiy;
                saveConfig(configPath, configData);
                refreshButton.emit('clicked');
                dlg.destroy();
            });

            dialog.show();
        };

        const updateUiTexts = (uiLang) => {
            currentUiLang = uiLang;
            page.title = getLabel('设置', 'Settings', uiLang);
            group.title = getLabel('个性化配置', 'Personalization', uiLang);
            langRow.title = getLabel('显示语言', 'Language', uiLang);
            styleRow.title = getLabel('对话框样式', 'Dialog Style', uiLang);
            styleStringList.splice(0, 4);
            const styleOptions = uiLang === 'DIY'
                ? ['丰富 / Rich', '简约 / Simple', '最小 / Minimal', '包名 / Package Only']
                : uiLang === 'en_US'
                    ? styleListEN
                    : styleListZH;
            styleOptions.forEach(item => styleStringList.append(item));
            editButton.label = getLabel('编辑', 'Edit', uiLang);
            refreshButton.label = getLabel('刷新', 'Refresh', uiLang);
            diyRow.title = getLabel('DIY 文案', 'DIY Text', uiLang);
            diyRow.subtitle = getLabel('编辑与刷新自定义文本', 'Edit and refresh custom text', uiLang);
        };

        const applyConfig = (selectedLang, selectedStyle) => {
            const configData = readConfig(configPath);
            configData.language = selectedLang;
            configData.style = selectedStyle;
            saveConfig(configPath, configData);
            currentLang = selectedLang;
            currentStyle = selectedStyle;
            currentUiLang = selectedLang === 'DIY' ? 'DIY' : selectedLang === 'en_US' ? 'en_US' : 'zh_CN';
            diyRow.visible = selectedLang === 'DIY';
            updateUiTexts(currentUiLang);
        };

        editButton.connect('clicked', () => {
            showDiyEditor();
        });

        refreshButton.connect('clicked', () => {
            const config = readConfig(configPath);
            currentLang = config.language;
            currentStyle = config.style;
            currentUiLang = currentLang === 'DIY' ? 'DIY' : currentLang === 'en_US' ? 'en_US' : 'zh_CN';
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