define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "language", "ui", "commands", "menus", "preferences",
        "settings", "notification.bubble", "installer", "save",
        "Editor", "editors", "tabManager", "Datagrid", "format",
        "language.complete", "fs", "c9", "run", "ensime-connector"
    ];
    main.provides = ["ensime"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var language = imports.language;
        var ui = imports.ui;
        var menus = imports.menus;
        var commands = imports.commands;
        var settings = imports.settings;
        var prefs = imports.preferences;
        var bubble = imports["notification.bubble"];
        var installer = imports.installer;
        var save = imports.save;
        var editors = imports.editors;
        var tabManager = imports.tabManager;
        var format = imports.format;
        var complete = imports["language.complete"];
        var fs = imports.fs;
        var c9 = imports.c9;
        var run = imports.run;
        var ensimeConnector = imports["ensime-connector"];

        var jsdiff = require("./lib/diff.js");
        var path = require("path");

        /***** Initialization *****/

        var ensimeRunning = false;
        var ensimeReady = false;

        // make sure all deps are installed
        installer.createSession("c9.ide.language.scala", require("./install"));

        /** Plugin **/

        var plugin = new Plugin("Ensime", main.consumes);
        imports.ensime = plugin;
        var emit = plugin.getEmitter();
        emit.setMaxListeners(20);

        /** Subplugins **/
        var MarkersEditor = require("./markers-editor")(imports, main.consumes);
        editors.register("ensimeMarkers", "URL Viewer", MarkersEditor, []);

        /** implementations of ENSIME Plugin */
        function loadSettings() {

            //Commands
            commands.addCommand({
                name: "startEnsime",
                group: "Scala",
                description: "Start the resident scala compiler.",
                isAvailable: function() {
                    return !ensimeRunning;
                },
                exec: function() {
                    startEnsime(true);
                }
            }, plugin);
            commands.addCommand({
                name: "stopEnsime",
                group: "Scala",
                description: "Stop the scala compiler.",
                isAvailable: function() {
                    return ensimeRunning;
                },
                exec: function() {
                    stopEnsime();
                }
            }, plugin);
            commands.addCommand({
                name: "updateEnsime",
                group: "Scala",
                description: "Update the ENSIME backend. Will take some minutes.",
                exec: function() {
                    updateEnsime();
                }
            }, plugin);
            commands.addCommand({
                name: "recompile",
                group: "Scala",
                description: "Perform a full typecheck of all Scala files.",
                bindKey: {
                    mac: "F8",
                    win: "F8",
                    linux: "F8"
                },
                isAvailable: function() {
                    return ensimeReady;
                },
                exec: function() {
                    var done = false;
                    ensimeConnector.on("event", function hdlr(e) {
                        if (!done && e.typehint === "FullTypeCheckCompleteEvent") {
                            done = true;
                            emit("rebuild");
                            bubble.popup("Recompile completed");
                            ensimeConnector.off("event", hdlr);
                        }
                    });
                    typecheck(function(err) {
                        if (err) return bubble.popup("Recompile failed: " + err);
                        if (!done) bubble.popup("Recompiling...");
                    });
                }
            }, plugin);
            commands.addCommand({
                name: "cleanBuild",
                group: "Scala",
                description: "Perform a clean build.",
                bindKey: {
                    mac: "Shift-F8",
                    win: "Shift-F8",
                    linux: "Shift-F8"
                },
                isAvailable: function() {
                    return ensimeReady;
                },
                exec: function() {
                    var done = false;
                    var recompiling = false;
                    var restarted = false;
                    ensimeConnector.on("event", function hdlr(e) {
                        if (!recompiling && e.typehint === "CompilerRestartedEvent") {
                            recompiling = true;
                            typecheck(function() {
                                restarted = true;
                            });
                        }
                        else if (restarted && !done && e.typehint === "FullTypeCheckCompleteEvent") {
                            done = true;
                            ensimeConnector.off("event", hdlr);
                            emit("rebuild");
                            bubble.popup("Build completed.");
                        }
                    });
                    ensimeUnloadAll(function(err) {
                        if (err) return bubble.popup("Clean build failed: " + err);
                        if (!done) bubble.popup("Performing a clean build...");
                    });
                }
            }, plugin);
            commands.addCommand({
                name: "ensimeConnectionInfo",
                group: "Scala",
                description: "Show the connection info from ENSIME.",
                isAvailable: function() {
                    return ensimeReady;
                },
                exec: function() {
                    connectionInfo(function(err, result) {
                        if (err) return err;
                        var msg = "Ensime: Protocol " + result.version + ", Implementation: " + result.implementation.name;
                        bubble.popup(msg);
                    });
                }
            }, plugin);
            commands.addCommand({
                name: "showMarkers",
                group: "Scala",
                description: "Show the window with all Scala compiler errors and warnings.",
                exec: function() {
                    var e = tabManager.openEditor("ensimeMarkers", true, function() {});
                    e.editor.on("refreshMarkers", function() {
                        emit("refreshMarkers");
                    }, plugin);
                }
            }, plugin);
            commands.addCommand({
                name: "showEnsimeLog",
                group: "Scala",
                description: "Show the log of the ENSIME server.",
                exec: showEnsimeLog
            }, plugin);
            commands.addCommand({
                name: "organiseImports",
                group: "Scala",
                description: "Organise the imports in the current file.",
                bindKey: {
                    mac: "Cmd-Shift-O",
                    win: "Ctrl-Shift-O",
                    linux: "Ctrl-Shift-O"
                },
                isAvailable: function() {
                    return ensimeReady &&
                        tabManager.focussedTab.editor.ace &&
                        tabManager.focussedTab.editor.ace.getOptions().mode == "ace/mode/scala";
                },
                exec: function() {
                    emit("organiseImports");
                }
            }, plugin);


            // Menus
            menus.setRootMenu("Scala", 550, plugin);
            menus.addItemByPath("Scala/Jump to Definition", new ui.item({
                command: "jumptodef"
            }), 100, plugin);
            menus.addItemByPath("Scala/Format", new ui.item({
                command: "formatcode"
            }), 110, plugin);
            menus.addItemByPath("Scala/Organise Imports", new ui.item({
                command: "organiseImports"
            }), 120, plugin);
            menus.addItemByPath("Scala/~", new ui.divider(), 199, plugin);
            menus.addItemByPath("Scala/Next Error", new ui.item({
                command: "jumpToMarker"
            }), 200, plugin);
            menus.addItemByPath("Scala/Errors and Warnings", new ui.item({
                command: "showMarkers"
            }), 210, plugin);
            menus.addItemByPath("Scala/~", new ui.divider(), 1000, plugin);
            menus.addItemByPath("Scala/Recompile All", new ui.item({
                command: "recompile"
            }), 1001, plugin);
            menus.addItemByPath("Scala/Clean", new ui.item({
                command: "cleanBuild"
            }), 1002, plugin);
            menus.addItemByPath("Scala/~", new ui.divider(), 2000, plugin);
            menus.addItemByPath("Scala/Start ENSIME", new ui.item({
                command: "startEnsime"
            }), 10550, plugin);
            menus.addItemByPath("Scala/Connection Info", new ui.item({
                command: "ensimeConnectionInfo"
            }), 10551, plugin);
            menus.addItemByPath("Scala/ENSIME Log", new ui.item({
                command: "showEnsimeLog"
            }), 10552, plugin);
            menus.addItemByPath("Scala/Stop ENSIME", new ui.item({
                command: "stopEnsime"
            }), 10553, plugin);
            menus.addItemByPath("Scala/Update ENSIME", new ui.item({
                command: "updateEnsime"
            }), 10554, plugin);

            settings.on("read", function(e) {
                settings.setDefaults("project/ensime", [
                    ["ensimeFile", "/home/ubuntu/workspace/.ensime"],
                    ["pluginDir", "/home/ubuntu/.c9/plugins/c9.ide.language.scala"],
                    ["sbt", "/usr/bin/sbt"],
                    ["noExecAnalysis", true],
                    ["node", "/home/ubuntu/.nvm/versions/node/v4.2.4/bin/node"]
                ]);
            });

            // Preferences
            prefs.add({
                "Language": {
                    position: 450,
                    "Scala (Ensime)": {
                        position: 100,
                        ".ensime Location": {
                            type: "textbox",
                            setting: "project/ensime/@ensimeFile",
                            position: 100
                        },
                        "Plugin Directory": {
                            type: "textbox",
                            setting: "project/ensime/@pluginDir",
                            position: 101
                        },
                        "SBT Executable": {
                            type: "textbox",
                            setting: "project/ensime/@sbt",
                            position: 102
                        },
                        "Node Executable": {
                            type: "textbox",
                            setting: "project/ensime/@node",
                            position: 103
                        },
                        "Don't use execAnalysis": {
                            type: "checkbox",
                            setting: "project/ensime/@noExecAnalysis",
                            position: 110
                        }
                    }
                }
            }, plugin);
        }


        /***** Lifecycle *****/

        plugin.on("load", function() {
            loadSettings();

            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_completer", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_outline", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_markers", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);
                handler.on("markers", function(markers) {
                    emit("markers", markers);
                });
                plugin.on("refreshMarkers", function() {
                    handler.emit("refreshMarkers");
                });
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_formatter", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);
                format.addFormatter("Scala (Scalariform)", "scala", plugin);
                format.on("format", formatUsingLanguage);
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_tooltip", function(err, handler) {
                if (err) return console.error(err);

                function sendSettings(handler) {
                    handler.emit("set_config", {
                        node: settings.get("project/ensime/@node"),
                        pluginDir: settings.get("project/ensime/@pluginDir")
                    });
                }
                settings.on("project/ensime", sendSettings.bind(null, handler), plugin);
                sendSettings(handler);

                setupConnectorBridge(handler);
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_jumptodefinition", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);
            });
            language.registerLanguageHandler("plugins/c9.ide.language.scala/worker/scala_refactor", function(err, handler) {
                if (err) return console.error(err);
                setupConnectorBridge(handler);

                handler.on("updateEditor", function(change) {
                    if (change.diff) {
                        //Diff based change
                        applyDiff(change.diff);
                    }
                });

                plugin.on("organiseImports", function() {
                    save.save(tabManager.focussedTab, {}, function(err) {
                        if (err) return console.error("Could not save the file.");
                        handler.emit("organiseImports", tabManager.focussedTab.path);
                    });
                });

                complete.on("replaceText", function(e) {
                    if (e.match && e.match.action) {
                        var action = e.match.action;
                        save.save(tabManager.focussedTab, {}, function(err) {
                            if (err) return console.error("Could not save the file.");

                            if (action.addImport) {
                                handler.emit("addImport", {
                                    path: tabManager.focussedTab.path,
                                    add: action.addImport
                                });
                            }
                        });
                    }
                });
            });

            connectToEnsime();

            save.on("afterSave", function(event) {
                emit("afterSave", event.path);
            });

            startEnsime(true);
        });

        plugin.on("unload", function() {
            ensimeRunning = false;
            ensimeReady = false;
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_refactor");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_jumptodefinition");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_tooltip");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_formatter");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_completer");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_outline");
            language.unregisterLanguageHandler("plugins/c9.ide.language.scala/worker/scala_markers");
        });

        function connectToEnsime() {
            ensimeConnector.on("starting", function() {
                ensimeRunning = true;
                ensimeReady = false;
                bubble.popup("ENSIME is starting...");
            });
            ensimeConnector.on("started", function() {
                ensimeRunning = true;
                ensimeReady = true;
                bubble.popup("ENSIME started.");
                typecheck(function(err) {
                    if (err) return bubble.popup("Typecheck not successful");
                });
            });
            ensimeConnector.on("stopped", function(code) {
                ensimeRunning = false;
                ensimeReady = false;
                bubble.popup("ENSIME stopped.");
            });
        }

        function setupConnectorBridge(handler) {
            handler.on("call", function(req) {
                ensimeConnector.call(req.request, function(err, resp){
                    handler.emit("call.result", {
                        id: req.id,
                        err: err,
                        result: resp
                    });
                });
            });
            ensimeConnector.on("event", function(event) {
                handler.emit("event", event);
            });
            plugin.on("afterSave", function(event) {
                handler.emit("afterSave", event.path);
            });
            plugin.on("rebuild", function(event) {
                handler.emit("rebuild", event);
            });
        }

        /** Uses the language to do the formatting.. this should be built in but isn't */
        function formatUsingLanguage(e) {
            language.getWorker(function(err, worker) {
                if (err) return console.error("Could not get language worker");
                worker.emit("code_format", {
                    data: {}
                });
                worker.once("code_format", function(e) {
                    var tab = tabManager.focussedTab;
                    if (tab) {
                        tab.document.value = e.data;
                        tab.editor.ace.selection.clearSelection();
                    }
                });
            });
            return true;
        }

        function applyDiff(diff) {
            jsdiff.applyPatches(diff, {
                loadFile: function(index, callback) {
                    var filename = index.oldFileName;
                    if (!filename) return callback("no edits");

                    var tab = tabManager.findTab(filename);
                    if (tab) {
                        //is open
                        callback(false, tab.document.value);
                    }
                    else {
                        //not open, load from the fs
                        var relativeFile = path.relative(c9.workspaceDir, filename);
                        fs.readFile(relativeFile, "utf-8", callback);
                    }
                },
                patched: function(index, content) {
                    var filename = index.oldFileName;
                    if (!filename) return;

                    if (index.newFileName !== index.oldFileName) {
                        //rename
                        filename = index.newFileName;
                        fs.rename(
                            path.relative(c9.workspaceDir, index.oldFileName),
                            path.relative(c9.workspaceDir, index.newFileName),
                            function(err) {
                                if (err) return console.error(`Failed to apply the diff: rename to ${index.newFileName} failed: ${err}`);
                                updateContents();
                            });
                    }
                    else updateContents();

                    function updateContents() {
                        var tab = tabManager.findTab(filename);
                        if (tab) {
                            //open in a tab - update it
                            tab.document.setBookmarkedValue(content);
                        }
                        else {
                            //not open in a tab - update on the fs
                            var relativeFile = path.relative(c9.workspaceDir, filename);
                            fs.writeFile(relativeFile, content, "utf-8", function(err) {
                                if (err) console.error(`Could not apply the diff to ${filename}: ${err}`);
                            });
                        }
                    }
                }
            });
        }

        function showEnsimeLog() {
            var dotEnsime = settings.get("project/ensime/@ensimeFile");
            var logfile = path.dirname(dotEnsime) + "/.ensime_cache/ensime.log";
            run.run({
                cmd: ["tail", "-f", logfile]

            }, {
                debug: false
            }, "ensime_log", function(err) {
                if (err) return console.error(err);

                tabManager.open({
                    editorType: "output",
                    active: true,
                    document: {
                        title: "ENSIME Log",
                        output: {
                            id: "ensime_log"
                        }
                    }
                }, function(err) {
                    if (err) return console.error(err);
                });
            });
        }

        /***** Register and define API *****/

        /** Ensime-server handling */
        function startEnsime(attach) {
            if (ensimeRunning) return;
            ensimeConnector.start(true);
        }

        function stopEnsime() {
            if (!ensimeRunning) return;
            ensimeConnector.stop();
        }

        function updateEnsime() {
            ensimeConnector.update(function(err) {
                if (err) {
                    bubble.popup("ENSIME could not be updated: " + err);
                }
                else {
                    bubble.popup("ENSIME was updated.");
                }
            });
        }

        function executeEnsime(req, callback) {
            ensimeConnector.call(req, callback);
        }

        /** Ensime commands. */


        function connectionInfo(callback) {
            executeEnsime({
                typehint: "ConnectionInfoReq"
            }, function(err, result) {
                if (err) return callback(err);
                callback(undefined, result);
            });
        }

        function typecheck(callback) {
            executeEnsime({
                typehint: "TypecheckAllReq"
            }, function(err, result) {
                if (err) return callback(err);
                callback(undefined, result);
            });
        }

        function ensimeUnloadAll(callback) {
            executeEnsime({
                typehint: "UnloadAllReq"
            }, function(err, result) {
                if (err) return callback(err);
                callback(undefined, result);
            });
        }

        plugin.freezePublicAPI({});

        register(null, {
            "ensime": plugin
        });
    }
});