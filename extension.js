const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const child_process = require('child_process');
const snippets = require("./smartsnippets.json");

const rootPath =
    vscode.workspace.workspaceFolders != undefined
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : "";

const luantiExeFilePath = path.join(rootPath, 'bin', 'luanti.exe');        
const doc_api_link = // TODO: Fetch latest version from a config so we arent modifying code for API version bumps
    "\n\n[View in lua_api.md](https://github.com/luanti-org/luanti/blob/5.11.0/doc/lua_api.md?plain=1#";
const luacheckrc = `read_globals = {
    "DIR_DELIM", "INIT",

    "minetest", "core",
    "dump", "dump2",

    "Raycast",
    "Settings",
    "PseudoRandom",
    "PerlinNoise",
    "VoxelManip",
    "SecureRandom",
    "VoxelArea",
    "PerlinNoiseMap",
    "PcgRandom",
    "ItemStack",
    "AreaStore",

    "vector",

    table = {
        fields = {
            "copy",
            "indexof",
            "insert_all",
            "key_value_swap",
            "shuffle",
        }
    },

    string = {
        fields = {
            "split",
            "trim",
        }
    },

    math = {
        fields = {
            "hypot",
            "sign",
            "factorial"
        }
    },
}`;

function makeFiles(files, folders, subfolder = '') {
    for (const folder of folders) {
        const fullpath = path.join(rootPath, subfolder, folder);
        if (!fs.existsSync(fullpath)) {
            fs.mkdirSync(fullpath, {recursive: true});
        }
    }
    for (const file of files) {
        const fullpath = path.join(rootPath, subfolder, file.name);
        if (!fs.existsSync(fullpath)) {
            fs.writeFileSync(fullpath, file.content);
        }
    }
}

// TODO: remove function
function isLuantiGameRoot() {
    // TODO: other check required for non windows    
    return fs.existsSync(luantiExeFilePath);
}

function getGameFolders() {
    var gamesFilePath = path.join(rootPath, "games");
    if (fs.existsSync(gamesFilePath))
    {
        return fs.readdirSync(gamesFilePath, { withFileTypes: true })
                .filter(directory => directory.isDirectory())
                .map(directory => '/games/' + directory.name)
    }

    return [];
}

function activate(context) {
    // Intellisense
    let completion = vscode.languages.registerCompletionItemProvider(
        { language: "lua", scheme: "file" },
        {
            provideCompletionItems(document, position) {
                // Only show snippets if in a Minetest workspace
                if (
                    vscode.workspace
                        .getConfiguration("minetest-tools")
                        .get("workspaceOnly") &&
                    !(
                        fs.existsSync(path.join(rootPath, "init.lua")) ||
                        fs.existsSync(path.join(rootPath, "mods")) ||
                        fs.existsSync(path.join(rootPath, "modpack.txt"))
                    )
                )
                    return [];

                const line = document.getText(
                    new vscode.Range(
                        new vscode.Position(position.line, 0),
                        position,
                    ),
                );
                const afterpos = new vscode.Range(
                    position,
                    new vscode.Position(position.line, position.character + 1),
                );
                const after = document.getText(afterpos);

                let items = [];

                for (const snippet of snippets) {
                    if (
                        snippet.token &&
                        line.match(
                            new RegExp(
                                `${snippet.token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}(?![^\\w\\n\\s\\r\\-])[\\w\\n\\s\\r\\-]*`,
                            ),
                        )
                    ) {
                        let item = new vscode.CompletionItem(snippet.prefix);
                        item.insertText = new vscode.SnippetString(
                            snippet.body,
                        );
                        item.documentation = new vscode.MarkdownString(
                            snippet.desc +
                                (snippet.doc_lines
                                    ? doc_api_link + snippet.doc_lines + ")"
                                    : ""),
                        );
                        item.kind = snippet.kind;
                        item.detail = snippet.detail || snippet.prefix;
                        item.additionalTextEdits =
                            snippet.token.match(/^[\(\[\{]$/) &&
                            after.match(/[\}\]\)]/)
                                ? [vscode.TextEdit.delete(afterpos)]
                                : null;

                        items.push(item);
                    }
                }

                return items;
            },
        },
        ":",
        ".",
        "[",
    );

    // Mod boilerplate
    let modproject = vscode.commands.registerCommand(
        "extension.modProject",
        async () => {
            if (rootPath == "") return;
            let name = vscode.workspace.name;
            let subfolder = '';

            if (isLuantiGameRoot()) {
                let gameModFolders = getGameFolders().map(f => path.join(f, 'mods'));

                // TODO: fix folder names ( '/' and '\' in names)
                subfolder = await vscode.window.showQuickPick( [...gameModFolders, '/mods'], {title: 'Where do you want to create the mod'})

                name = await vscode.window.showInputBox({
                    prompt: "Enter name of the mod",
                    value: "",
                });
                subfolder = path.join(subfolder,name);
            }

            const files = [
                {
                    name: "init.lua",
                    content: "",
                },
                {
                    name: "mod.conf",
                    content: `name = ${name}\ndescription = \ndepends = \noptional_depends = `,
                },
                {
                    name: "README.md",
                    content: "",
                },
                {
                    name: "LICENSE.txt",
                    content: "",
                },
                {
                    name: ".luacheckrc",
                    content: luacheckrc,
                },
            ];
            const folders = ["textures", "models", "sounds"];
            makeFiles(files, folders, subfolder);
        },
    );

    // Game boilerplate
    let gameproject = vscode.commands.registerCommand(
        "extension.gameProject",
        async () => {
            if (rootPath == "") return;
            
            let gameName = vscode.workspace.name;
            let gameFolder = '';

            // pick game folder
            const folderOptions = [
                { label: "Root folder ('/')", value: "" },
                { label: "Games folder ('/games')", value: "/games" },
                { label: "Pick other folder", value: "other" }
            ]

            const pickedFolderOption = await vscode.window.showQuickPick( folderOptions, {title: 'Where do you want to create the game'})

            if (!pickedFolderOption)
            {
                return;
            }

            if (pickedFolderOption.value === 'other') {
                // pick other folder
                const options = {
                    canSelectMany: false,
                    openLabel: 'Select',
                    canSelectFiles: false,
                    canSelectFolders: true
                };
        
                const pickedFolder = await vscode.window.showOpenDialog(options);
                if (!pickedFolder || pickedFolder.length < 1) {
                    return
                }

                gameFolder = pickedFolder[0].path;
            }
            else {
                gameFolder = pickedFolderOption.value;
            }
            
            // Input game name of folder is not the root
            if (gameFolder) {
                gameName = await vscode.window.showInputBox({
                    prompt: "Enter name of the game",
                    value: "",
                });

                if (!gameName)
                {
                    return;
                }

                gameFolder = path.join('games',gameName);
            }

            // create game files
            const files = [
                {
                    name: "game.conf",
                    content: `name = ${gameName
                        .replace(/[_-]/g, " ")
                        .replace(/(^| )(\w)/g, function (m) {
                            return m.toUpperCase();
                        })}\nauthor = \ndescription = `,
                },
                {
                    name: "README.md",
                    content: "",
                },
                {
                    name: "LICENSE.txt",
                    content: "",
                },
                {
                    name: ".luacheckrc",
                    content: luacheckrc,
                },
            ];
            const folders = ["menu", "mods"];
            makeFiles(files, folders, gameFolder);
        },
    );

    // .luacheckrc generator
    let luacheck = vscode.commands.registerCommand(
        "extension.luacheckrc",
        () => {
            if (rootPath == "") return;
            makeFiles(
                [
                    {
                        name: ".luacheckrc",
                        content: luacheckrc,
                    },
                ],
                [],
            );
        },
    );

    // Toggle workspace-only snippets
    let toggle = vscode.commands.registerCommand(
        "extension.workspaceToggle",
        () => {
            const conf = vscode.workspace.getConfiguration("minetest-tools");
            const newVal = conf.get("workspaceOnly") ? false : true;
            conf.update("workspaceOnly", newVal, true);
            vscode.window.showInformationMessage(
                newVal
                    ? "Luanti Intellisense active in workspace only."
                    : "Luanti Intellisense active for all Lua files.",
            );
        },
    );

    // Start Luanti game
    let startLuantiGame = vscode.commands.registerCommand(
        "extension.startLuantiGame",
        () => {
            if(isLuantiGameRoot()) {
                vscode.window.showInformationMessage('starting luanti game');

                // TODO: other file for non windows
                child_process.execFile(luantiExeFilePath, null, (error, stdout, stderr) => {
                    if (error) {
                        vscode.window.showErrorMessage(`Error: ${error.message}`);
                        return;
                    }
                });
            }
            else {
                vscode.window.showErrorMessage('Could not find luanti executable');
            }
        },
    );

    context.subscriptions.push(
        completion,
        modproject,
        gameproject,
        luacheck,
        toggle,
    );

    console.log("Luanti Tools extension is active.");
}

exports.activate = activate;

module.exports = {
    activate,
};
