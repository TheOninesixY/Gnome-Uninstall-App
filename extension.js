import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GObject from 'gi://GObject';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AppMenu from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const I18N = {
    'zh_CN': {
        'menu_uninstall': '卸载',
        'confirm_title': '确认要卸载该应用？',
        'confirm_prefix': '确认将卸载 ',
        'cancel': '取消',
        'retain_uninstall': '保留数据卸载',
        'uninstall': '卸载',
        'unknown_app': '未知应用'
    },
    'en_US': {
        'menu_uninstall': 'Uninstall',
        'confirm_title': 'Are you sure you want to uninstall this app?',
        'confirm_prefix': 'Confirm uninstalling ',
        'cancel': 'Cancel',
        'retain_uninstall': 'Uninstall & Keep Data',
        'uninstall': 'Uninstall',
        'unknown_app': 'Unknown Application'
    }
};

function getConfig(pluginDir) {
    let config = { language: 'zh_CN', style: 'rich' };
    const configPath = pluginDir.get_path() + '/config.json';
    try {
        const file = Gio.File.new_for_path(configPath);
        if (file.query_exists(null)) {
            const [ok, content] = file.load_contents(null);
            if (ok) {
                const parsed = JSON.parse(new TextDecoder().decode(content));
                if (parsed.language) config.language = parsed.language;
                if (parsed.style) config.style = parsed.style;
            }
        }
    } catch (e) {}
    return config;
}

function getTranslation(pluginDir, key) {
    const config = getConfig(pluginDir);
    return I18N[config.language][key] || key;
}

function getDesktopFilePath(app) {
    try {
        const appInfo = app?.get_app_info?.();
        return appInfo?.get_filename?.() ?? null;
    } catch (e) {
        return null;
    }
}

function getDesktopFileBaseName(app) {
    const path = getDesktopFilePath(app);
    if (!path)
        return null;

    const parts = path.split('/');
    return parts[parts.length - 1] ?? null;
}

function stripDesktopSuffix(name) {
    if (!name)
        return null;

    return name.endsWith('.desktop')
        ? name.slice(0, -'.desktop'.length)
        : name;
}

function canShowUninstall(app) {
    return getDesktopFilePath(app) !== null;
}

function runSync(argv) {
    try {
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        const [ok, stdoutBuf, stderrBuf] = proc.communicate_utf8(null, null);

        return {
            ok: ok && proc.get_successful(),
            stdout: stdoutBuf?.trim?.() || '',
            stderr: stderrBuf?.trim?.() || '',
        };
    } catch (e) {
        return { ok: false, stdout: '', stderr: String(e) };
    }
}

function resolveUninstallTarget(app) {
    const desktopFile = getDesktopFilePath(app);
    if (!desktopFile)
        throw new Error('No desktop file path for this app');

    const baseName = getDesktopFileBaseName(app);
    const desktopId = stripDesktopSuffix(baseName);

    const homeDir = GLib.get_home_dir();
    const isUserDesktop = desktopFile.startsWith(homeDir) || desktopFile.includes('/.local/share/');

    const makeCombinedArgv = (needSudo, removeCmdArray) => {
        const rmPart = `rm -f "${desktopFile}"`;
        const uninstallPart = removeCmdArray.join(' ');
        const combinedScript = `${rmPart} && ${uninstallPart}`;

        if (needSudo) {
            return ['pkexec', 'sh', '-c', combinedScript];
        } else {
            return ['sh', '-c', combinedScript];
        }
    };

    // 1. 检查 RPM (Fedora/RHEL)
    if (GLib.find_program_in_path('rpm')) {
        const rpm = runSync(['rpm', '-qf', '--qf', '%{NAME}', desktopFile]);
        if (rpm.ok && rpm.stdout) {
            return {
                kind: 'rpm',
                label: rpm.stdout,
                getArgv: () => makeCombinedArgv(true, ['/usr/bin/dnf', 'remove', '-y', rpm.stdout]),
            };
        }
    }

    // 2. 检查 APT (Debian/Ubuntu)
    if (GLib.find_program_in_path('dpkg')) {
        const dpkg = runSync(['dpkg', '-S', desktopFile]);
        if (dpkg.ok && dpkg.stdout) {
            const pkgName = dpkg.stdout.split(':')[0]?.trim();
            if (pkgName) {
                return {
                    kind: 'apt',
                    label: pkgName,
                    getArgv: () => makeCombinedArgv(true, ['/usr/bin/apt-get', 'remove', '-y', pkgName]),
                };
            }
        }
    }

    // 3. 检查 Pacman (Arch Linux)
    if (GLib.find_program_in_path('pacman')) {
        const pacman = runSync(['pacman', '-Qqo', desktopFile]);
        if (pacman.ok && pacman.stdout) {
            return {
                kind: 'pacman',
                label: pacman.stdout,
                getArgv: () => makeCombinedArgv(true, ['/usr/bin/pacman', '-Rns', '--noconfirm', pacman.stdout]),
            };
        }
    }

    // 4. 检查 Flatpak
    if (desktopFile.includes('/flatpak/') && desktopId) {
        const isUserFlatpak = desktopFile.includes('/.local/share/flatpak/');
        
        return {
            kind: 'flatpak',
            label: desktopId,
            getArgv: (extraArgs = []) => {
                const baseFlatpakCmd = isUserFlatpak 
                    ? ['flatpak', 'uninstall', '--user', '-y', ...extraArgs, desktopId]
                    : ['flatpak', 'uninstall', '--system', '-y', ...extraArgs, desktopId];
                
                const needSudo = !isUserFlatpak || !isUserDesktop;
                return makeCombinedArgv(needSudo, baseFlatpakCmd);
            }
        };
    }

    // 5. 检查 Snap
    if (desktopFile.includes('/snapd/') && desktopId) {
        let snapName = desktopId;
        if (desktopId.includes('_'))
            snapName = desktopId.split('_')[0];

        return {
            kind: 'snap',
            label: snapName,
            getArgv: () => makeCombinedArgv(true, ['/usr/bin/snap', 'remove', snapName]),
        };
    }

    // 6. 兜底方案
    return {
        kind: 'standalone',
        label: baseName,
        getArgv: () => makeCombinedArgv(!isUserDesktop, ['true'])
    };
}

function launchUninstall(argv) {
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
}

const SystemConfirmDialog = GObject.registerClass(
class SystemConfirmDialog extends ModalDialog.ModalDialog {
    _init(pluginDir, title, appName, packageName, callback, hasExtraFlatpakOption = false, flatpakCallback = null) {
        super._init({ styleClass: 'end-session-dialog' });

        const config = getConfig(pluginDir);

        let mainContentBox = new St.BoxLayout({
            style_class: 'end-session-dialog-main-box',
            vertical: true
        });
        this.contentLayout.add_child(mainContentBox);

        let titleLabel = new St.Label({
            style_class: 'end-session-dialog-headline',
            style: 'font-size: 16pt; font-weight: bold; margin-bottom: 12px;',
            text: title,
            x_align: Clutter.ActorAlign.CENTER
        });
        mainContentBox.add_child(titleLabel);

        let descBox = new St.BoxLayout({
            vertical: true
        });
        mainContentBox.add_child(descBox);

        const showAppName = (config.style === 'rich' || config.style === 'simple');
        const showPackageName = (config.style === 'rich' || config.style === 'package_only');

        if (showAppName) {
            let fullDisplayName = getTranslation(pluginDir, 'confirm_prefix') + appName;
            let nameLabel = new St.Label({
                style_class: 'end-session-dialog-description',
                style: 'font-size: 11pt;',
                text: fullDisplayName,
                x_align: Clutter.ActorAlign.CENTER
            });
            descBox.add_child(nameLabel);
        }

        if (showPackageName) {
            let packageLabel = new St.Label({
                style: `font-size: 9pt; color: rgba(255, 255, 255, 0.35); ${showAppName ? 'margin-top: 4px;' : ''}`,
                text: packageName,
                x_align: Clutter.ActorAlign.CENTER
            });
            descBox.add_child(packageLabel);
        }

        this.addButton({
            label: getTranslation(pluginDir, 'cancel'),
            action: () => this.close(),
            key: Clutter.KEY_Escape
        });

        if (hasExtraFlatpakOption && flatpakCallback) {
            this.addButton({
                label: getTranslation(pluginDir, 'retain_uninstall'),
                action: () => {
                    flatpakCallback();
                    this.close();
                }
            });
            this.addButton({
                label: getTranslation(pluginDir, 'uninstall'),
                action: () => {
                    callback();
                    this.close();
                },
                isDefault: true
            });
        } else {
            this.addButton({
                label: getTranslation(pluginDir, 'uninstall'),
                action: () => {
                    callback();
                    this.close();
                },
                isDefault: true,
                key: Clutter.KEY_Return
            });
        }
    }
});

export default class UninstallButtonExtension extends Extension {
    enable() {
        const pluginDir = this.dir;
        this._injectionManager = new InjectionManager();

        this._injectionManager.overrideMethod(
            AppMenu.AppMenu.prototype,
            'setApp',
            originalMethod => function (...args) {
                originalMethod.call(this, ...args);

                if (!this._uninstallItem) {
                    this._uninstallItem = this.addAction(getTranslation(pluginDir, 'menu_uninstall'), () => {
                        try {
                            const target = resolveUninstallTarget(this._app);
                            const appName = this._app?.get_name?.() || getTranslation(pluginDir, 'unknown_app');
                            const packageName = target.label;

                            let dialog;
                            if (target.kind === 'flatpak') {
                                dialog = new SystemConfirmDialog(
                                    pluginDir,
                                    getTranslation(pluginDir, 'confirm_title'),
                                    appName,
                                    packageName,
                                    () => {
                                        const finalArgv = target.getArgv(['--delete-data']);
                                        Main.notify(getTranslation(pluginDir, 'menu_uninstall'), `Removing ${target.label} fully via ${target.kind}`);
                                        launchUninstall(finalArgv);
                                    },
                                    true,
                                    () => {
                                        const finalArgv = target.getArgv([]);
                                        Main.notify(getTranslation(pluginDir, 'menu_uninstall'), `Removing ${target.label} via ${target.kind}`);
                                        launchUninstall(finalArgv);
                                    }
                                );
                            } else {
                                dialog = new SystemConfirmDialog(
                                    pluginDir,
                                    getTranslation(pluginDir, 'confirm_title'),
                                    appName,
                                    packageName,
                                    () => {
                                        const finalArgv = target.getArgv();
                                        Main.notify(getTranslation(pluginDir, 'menu_uninstall'), `Removing ${target.label} via ${target.kind}`);
                                        launchUninstall(finalArgv);
                                    }
                                );
                            }

                            dialog.open();
                        } catch (e) {
                            logError(e, 'Failed to uninstall app');
                            Main.notifyError(
                                'Uninstall failed',
                                e.message ?? String(e)
                            );
                        }
                    });
                }

                this._uninstallItem.label.text = getTranslation(pluginDir, 'menu_uninstall');
                this._uninstallItem.visible = canShowUninstall(this._app);
            }
        );
    }

    disable() {
        this._injectionManager?.clear();
        this._injectionManager = null;
    }
}
