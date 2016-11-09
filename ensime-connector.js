define(function(require, exports, module) {
  main.consumes = ["Plugin", "installer", "settings", "proc", "c9"];
  main.provides = ["ensime-connector"];
  return main;

  function main(options, imports, register) {
    var Plugin = imports.Plugin;
    var installer = imports.installer;
    var settings = imports.settings;
    var proc = imports.proc;
    var c9 = imports.c9;

    // make sure all deps are installed
    installer.createSession("c9.ide.language.scala", require("./install"));

    var plugin = new Plugin("Ensime", main.consumes);
    var emit = plugin.getEmitter();

    var ensimeProcess;
    var last_call_id = 0;
    var pendingCalls = {};

    //settings
    var node;
    var sbt;
    var ensimeFile;
    var pluginDir;

    //TODO maybe move the respective settings here completely? (including UI)
    function updateSettings() {
      ensimeFile = settings.get("project/ensime/@ensimeFile");
      sbt = settings.get("project/ensime/@sbt");
      node = settings.get("project/ensime/@node");
      // noExecAnalysis = settings.get("project/ensime/@noExecAnalysis");
      pluginDir = settings.get("project/ensime/@pluginDir");
    }

    plugin.on("load", function() {
      settings.on("project/ensime", updateSettings);
      updateSettings();
    });
    plugin.on("unload", function() {
      node = undefined;
      sbt = undefined;
      ensimeFile = undefined;
      pluginDir = undefined;
      ensimeProcess = undefined;
      pendingCalls = {};
    });

    function utoa(str) {
      return window.btoa(encodeURIComponent(str));
    }

    function atou(str) {
      return decodeURIComponent(window.atob(str));
    }

    function handleEvent(event) {
      if (event.type === "started") {
        console.log("ENSIME started.");
        emit("started");
      }
      else if (event.type == "callResponse") {
        var call = pendingCalls[event.callId];
        delete pendingCalls[event.callId];
        if (call) call(event.error, event.response);
      }
      else {
        console.debug("ENSIME-EVENT: " + JSON.stringify(event));
        emit("event", event);
      }
    }

    function start(attach) {
      console.log("Will start ENSIME with attach=" + attach);
      console.debug(`Running: ${node} ${pluginDir}/server/ensime-runner.js ${ensimeFile} ${sbt} ${attach}`);
      proc.spawn(node, {
        args: [pluginDir + "/server/ensime-runner.js",
          ensimeFile, sbt,
          attach.toString()
        ],
        cwd: c9.workspaceDir
      }, function(err, process) {
        if (err) return console.error(err);
        ensimeProcess = process;
        console.log("Waiting for ENSIME to start...");
        emit("starting");

        var buffer = "";

        function receivedData(chunk) {
          buffer += chunk;
          var delim = buffer.indexOf("|");
          if (delim == -1) return;

          var decoded = atou(buffer.substr(0, delim));
          buffer = buffer.substr(delim + 1);
          var event = JSON.parse(decoded);
          handleEvent(event);
          receivedData("");
        }

        process.stdout.on("data", receivedData);
        process.stderr.on("data", function(chunk) {
          console.error(chunk);
        });
        process.stdout.on("error", function(error) {
          console.error(error);
        });
        process.stderr.on("error", function(error) {
          console.error(error);
        });
        process.on("exit", function(code) {
          emit("stopped", code);
          ensimeProcess = undefined;
          console.log("Ensime server stopped (code " + code + ")");
        });
      });
    }

    function stop() {
      console.log("Will stop ENSIME");
      if (ensimeProcess)
        ensimeProcess.kill();
      ensimeProcess = undefined;
      emit("stopped", -1);
    }

    function update(callback) {
      var calledBack = false;

      console.log("Will update ENSIME");
      proc.spawn(node, {
        args: [pluginDir + "/server/ensime-update.js",
          ensimeFile, sbt
        ],
        cwd: c9.workspaceDir
      }, function(err, process) {
        if (err) return console.error(err);
        ensimeProcess = undefined;
        console.log("Waiting for ENSIME to update...");
        emit("stopped");
        emit("updating");

        process.stdout.on("data", function(chunk) {
          //TODO chunk to message mapping might not always be 1:1
          console.debug("ENSIME-EVENT: " + chunk);
          if (calledBack) return;
          var event = JSON.parse(chunk);
          if (event.type === "updated") {
            calledBack = true;
            return callback();
          }
        });
        process.stderr.on("data", function(chunk) {
          console.log("log", chunk);
        });
        process.on("exit", function(code) {
          if (calledBack) return;
          if (code != 0) callback(`Update failed with code ${code}`);
          else callback();
        });
      });
    }

    function call(request, callback) {
      if (!ensimeProcess) return callback("ENSIME not running");
      if (!request) return callback("No request");

      request.callId = last_call_id++;
      ensimeProcess.stdin.write(utoa(JSON.stringify(request)) + "|");

      pendingCalls[request.callId] = callback;
    }

    plugin.freezePublicAPI({
      start: start,
      stop: stop,
      update: update,
      call: call,

      _events: [
        "starting",
        "started",
        "stopped",
        "updating",
        "event"
      ]
    });
    register(null, {
      "ensime-connector": plugin
    });
  }
});
