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

function loadDesktopFileContents(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [ok, contents] = file.load_contents(null);
        if (ok && contents)
            return new TextDecoder().decode(contents);
    } catch (e) {}

    return '';
}

function getDesktopFileKeyValue(path, key) {
    const contents = loadDesktopFileContents(path);
    const regex = new RegExp(`^${key}\\s*=\\s*(.*)$`, 'im');
    const match = contents.match(regex);
    return match ? match[1].trim() : null;
}

function isFlatpakDesktopFile(path) {
    if (!path)
        return false;

    const contents = loadDesktopFileContents(path);
    return /\bX-Flatpak\s*=\s*true\b/i.test(contents)
        || /\bX-Flatpak-Scope\s*=\s*(user|system)\b/i.test(contents)
        || path.includes('/var/lib/flatpak/')
        || path.includes('/flatpak/')
        || path.includes('/.local/share/flatpak/');
}

// Async helpers: non-blocking file readers and key/value extractors
function loadDesktopFileContentsAsync(path) {
    return new Promise(resolve => {
        try {
            const file = Gio.File.new_for_path(path);
            file.load_contents_async(null, (f, res) => {
                try {
                    const [ok, contents] = f.load_contents_finish(res);
                    if (ok && contents)
                        resolve(new TextDecoder().decode(contents));
                    else
                        resolve('');
                } catch (e) {
                    resolve('');
                }
            });
        } catch (e) {
            resolve('');
        }
    });
}

async function getDesktopFileKeyValueAsync(path, key) {
    const contents = await loadDesktopFileContentsAsync(path);
    const regex = new RegExp(`^${key}\\s*=\\s*(.*)$`, 'im');
    const match = contents.match(regex);
    return match ? match[1].trim() : null;
}

async function isFlatpakDesktopFileAsync(path) {
    if (!path)
        return false;

    const contents = await loadDesktopFileContentsAsync(path);
    return /\bX-Flatpak\s*=\s*true\b/i.test(contents)
        || /\bX-Flatpak-Scope\s*=\s*(user|system)\b/i.test(contents)
        || path.includes('/var/lib/flatpak/')
        || path.includes('/flatpak/')
        || path.includes('/.local/share/flatpak/');
}

function canShowRetainUninstall(app) {
    const desktopFile = getDesktopFilePath(app);
    return desktopFile !== null && isFlatpakDesktopFile(desktopFile);
}

function runAsync(argv) {
    return new Promise(resolve => {
        try {
            const proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [ok, stdoutBuf, stderrBuf] = source.communicate_utf8_finish(res);
                    resolve({
                        ok: ok && source.get_successful(),
                        stdout: stdoutBuf?.trim?.() || '',
                        stderr: stderrBuf?.trim?.() || '',
                    });
                } catch (e) {
                    resolve({ ok: false, stdout: '', stderr: String(e) });
                }
            });
        } catch (e) {
            resolve({ ok: false, stdout: '', stderr: String(e) });
        }
    });
}

async function flatpakAppInstalled(scope, desktopId) {
    const scopeArgs = scope === 'user' ? ['--user'] : scope === 'system' ? ['--system'] : [];
    const result = await runAsync(['flatpak', 'info', ...scopeArgs, desktopId]);
    return result.ok;
}

async function detectFlatpakScope(desktopFile, desktopId) {
    const homeDir = GLib.get_home_dir();
    const fileLooksUserScoped = desktopFile.startsWith(homeDir) || desktopFile.includes('/.local/share/');
    const fileLooksFlatpakExport = await isFlatpakDesktopFileAsync(desktopFile);

    if (fileLooksFlatpakExport && fileLooksUserScoped)
        return 'user';

    const scopeValue = await getDesktopFileKeyValueAsync(desktopFile, 'X-Flatpak-Scope');
    if (scopeValue) {
        const normalized = scopeValue.trim().toLowerCase();
        if (normalized === 'user' || normalized === 'system')
            return normalized;
    }

    if (GLib.find_program_in_path('flatpak')) {
        if (await flatpakAppInstalled('user', desktopId))
            return 'user';
        if (await flatpakAppInstalled('system', desktopId))
            return 'system';
    }

    if (fileLooksFlatpakExport)
        return fileLooksUserScoped ? 'user' : 'system';

    return null;
}

async function resolveUninstallTargetAsync(app) {
    const desktopFile = getDesktopFilePath(app);
    if (!desktopFile)
        throw new Error('No desktop file path for this app');

    const baseName = getDesktopFileBaseName(app);
    const desktopId = stripDesktopSuffix(baseName);

    const homeDir = GLib.get_home_dir();
    const isUserDesktop = desktopFile.startsWith(homeDir) || desktopFile.includes('/.local/share/');

    const makeCombinedArgv = (needSudo, removeCmdArray, skipDesktopRemove = false) => {
        if (skipDesktopRemove) {
            return needSudo
                ? ['pkexec', ...removeCmdArray]
                : removeCmdArray;
        }

        const rmPart = `rm -f "${desktopFile}"`;
        const uninstallPart = removeCmdArray.join(' ');
        const combinedScript = `${rmPart} && ${uninstallPart}`;

        if (needSudo) {
            return ['pkexec', 'sh', '-c', combinedScript];
        } else {
            return ['sh', '-c', combinedScript];
        }
    };

    const makePackageManagerArgv = removeCmdArray => makeCombinedArgv(true, removeCmdArray);

    // 1. 检查 RPM (Fedora/RHEL)
    if (GLib.find_program_in_path('rpm')) {
        const rpm = await runAsync(['rpm', '-qf', '--qf', '%{NAME}', desktopFile]);
        if (rpm.ok && rpm.stdout) {
            const cmd = ['/usr/bin/dnf', 'remove', '-y', rpm.stdout];
            return {
                kind: 'rpm',
                label: rpm.stdout,
                getArgv: () => makePackageManagerArgv(cmd),
                getElevatedArgv: () => makePackageManagerArgv(cmd),
            };
        }
    }

    // 2. 检查 APT (Debian/Ubuntu)
    if (GLib.find_program_in_path('dpkg')) {
        const dpkg = await runAsync(['dpkg', '-S', desktopFile]);
        if (dpkg.ok && dpkg.stdout) {
            const pkgName = dpkg.stdout.split(':')[0]?.trim();
            if (pkgName) {
                const cmd = ['/usr/bin/apt-get', 'remove', '-y', pkgName];
                return {
                    kind: 'apt',
                    label: pkgName,
                    getArgv: () => makePackageManagerArgv(cmd),
                    getElevatedArgv: () => makePackageManagerArgv(cmd),
                };
            }
        }
    }

    // 3. 检查 Pacman (Arch Linux)
    if (GLib.find_program_in_path('pacman')) {
        const pacman = await runAsync(['pacman', '-Qqo', desktopFile]);
        if (pacman.ok && pacman.stdout) {
            const cmd = ['/usr/bin/pacman', '-Rns', '--noconfirm', pacman.stdout];
            return {
                kind: 'pacman',
                label: pacman.stdout,
                getArgv: () => makePackageManagerArgv(cmd),
                getElevatedArgv: () => makePackageManagerArgv(cmd),
            };
        }
    }

    // 4. 检查 Flatpak
    if ((desktopFile.includes('/flatpak/') || desktopFile.includes('/.local/share/flatpak/')) && desktopId) {
        const flatpakScope = await detectFlatpakScope(desktopFile, desktopId);
        const isUserFlatpak = flatpakScope === 'user';

        return {
            kind: 'flatpak',
            label: desktopId,
            getArgv: (extraArgs = []) => {
                const baseFlatpakCmd = isUserFlatpak
                    ? ['flatpak', 'uninstall', '--user', '-y', ...extraArgs, desktopId]
                    : ['flatpak', 'uninstall', '--system', '-y', ...extraArgs, desktopId];

                return makeCombinedArgv(false, baseFlatpakCmd, true);
            },
            getElevatedArgv: (extraArgs = []) => {
                const baseFlatpakCmd = isUserFlatpak
                    ? ['flatpak', 'uninstall', '--user', '-y', ...extraArgs, desktopId]
                    : ['flatpak', 'uninstall', '--system', '-y', ...extraArgs, desktopId];

                return makeCombinedArgv(true, baseFlatpakCmd, true);
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

function needsElevatedRetry(result) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
    return /permission|denied|not authorized|authentication|sudo|administrator|root|polkit/i.test(output);
}

function launchUninstall(argv, fallbackArgv = null, onComplete = null) {
    const finish = result => {
        if (onComplete)
            onComplete(result);

        if (result.ok || !fallbackArgv || !needsElevatedRetry(result))
            return;

        launchUninstall(fallbackArgv, null, onComplete);
    };

    try {
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );

        proc.communicate_utf8_async(null, null, (source, res) => {
            try {
                const [ok, stdoutBuf, stderrBuf] = source.communicate_utf8_finish(res);
                finish({
                    ok: ok && source.get_successful(),
                    stdout: stdoutBuf?.trim?.() || '',
                    stderr: stderrBuf?.trim?.() || '',
                });
            } catch (e) {
                finish({ ok: false, stdout: '', stderr: String(e) });
            }
        });
    } catch (e) {
        finish({ ok: false, stdout: '', stderr: String(e) });
    }
}

const SystemConfirmDialog = GObject.registerClass(
class SystemConfirmDialog extends ModalDialog.ModalDialog {
    _init(pluginDir, title, appName, packageName, callback, buttonLabel = null) {
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

        this.addButton({
            label: buttonLabel ?? getTranslation(pluginDir, 'uninstall'),
            action: () => {
                callback();
                this.close();
            },
            isDefault: true,
            key: Clutter.KEY_Return
        });
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

                if (!this._retainUninstallItem) {
                    this._retainUninstallItem = this.addAction(getTranslation(pluginDir, 'retain_uninstall'), async () => {
                        try {
                            const target = await resolveUninstallTargetAsync(this._app);
                            const appName = this._app?.get_name?.() || getTranslation(pluginDir, 'unknown_app');
                            const packageName = target.label;

                            const dialog = new SystemConfirmDialog(
                                pluginDir,
                                getTranslation(pluginDir, 'confirm_title'),
                                appName,
                                packageName,
                                () => {
                                    const finalArgv = target.kind === 'flatpak'
                                        ? target.getArgv([])
                                        : target.getArgv();
                                    const fallbackArgv = target.kind === 'flatpak' && target.getElevatedArgv
                                        ? target.getElevatedArgv([])
                                        : null;

                                    Main.notify(getTranslation(pluginDir, 'retain_uninstall'), `Removing ${target.label} via ${target.kind}`);
                                    launchUninstall(finalArgv, fallbackArgv, result => {
                                        if (!result.ok) {
                                            Main.notifyError(
                                                getTranslation(pluginDir, 'retain_uninstall'),
                                                result.stderr || `Failed to remove ${target.label}`
                                            );
                                        }
                                    });
                                },
                                getTranslation(pluginDir, 'retain_uninstall')
                            );

                            dialog.open();
                        } catch (e) {
                            logError(e, 'Failed to retain uninstall app');
                            Main.notifyError(
                                'Retain uninstall failed',
                                e.message ?? String(e)
                            );
                        }
                    });
                }

                if (!this._uninstallItem) {
                    this._uninstallItem = this.addAction(getTranslation(pluginDir, 'menu_uninstall'), async () => {
                        try {
                            const target = await resolveUninstallTargetAsync(this._app);
                            const appName = this._app?.get_name?.() || getTranslation(pluginDir, 'unknown_app');
                            const packageName = target.label;

                            const dialog = new SystemConfirmDialog(
                                pluginDir,
                                getTranslation(pluginDir, 'confirm_title'),
                                appName,
                                packageName,
                                () => {
                                    const finalArgv = target.kind === 'flatpak'
                                        ? target.getArgv(['--delete-data'])
                                        : target.getArgv();
                                    const fallbackArgv = target.kind === 'flatpak' && target.getElevatedArgv
                                        ? target.getElevatedArgv(['--delete-data'])
                                        : null;

                                    Main.notify(getTranslation(pluginDir, 'menu_uninstall'), `Removing ${target.label} via ${target.kind}`);
                                    launchUninstall(finalArgv, fallbackArgv, result => {
                                        if (!result.ok) {
                                            Main.notifyError(
                                                getTranslation(pluginDir, 'menu_uninstall'),
                                                result.stderr || `Failed to remove ${target.label}`
                                            );
                                        }
                                    });
                                }
                            );

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

                const canUninstall = canShowUninstall(this._app);
                this._uninstallItem.label.text = getTranslation(pluginDir, 'menu_uninstall');
                this._uninstallItem.visible = canUninstall;

                this._retainUninstallItem.label.text = getTranslation(pluginDir, 'retain_uninstall');
                this._retainUninstallItem.visible = false;
                if (canUninstall) {
                    const desktopFile = getDesktopFilePath(this._app);
                    if (desktopFile) {
                        isFlatpakDesktopFileAsync(desktopFile).then(isFlatpak => {
                            this._retainUninstallItem.visible = isFlatpak;
                        }).catch(() => {
                            this._retainUninstallItem.visible = false;
                        });
                    }
                }
            }
        );
    }

    disable() {
        this._uninstallItem = null;
        this._retainUninstallItem = null;
        this._injectionManager?.clear();
        this._injectionManager = null;
    }
}
