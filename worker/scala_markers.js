define(function(require, exports, module) {

  var baseHandler = require("plugins/c9.ide.language/base_handler");
  var workerUtil = require("plugins/c9.ide.language/worker_util");
  var util = require("./util");

  var handler = module.exports = Object.create(baseHandler);
  var emitter;

  handler.handlesLanguage = function(language) {
    return language === "scala";
  };

  handler.init = function(callback) {
    emitter = handler.getEmitter();
    console.log("Scala markers initialized.");
    emitter.on("event", handleEvent);
    emitter.on("afterSave", handleSave);
    emitter.on("rebuild", function() {
      console.info("Refreshing all markers..");
      workerUtil.refreshAllMarkers();
    });
    callback();
  };

  var markers = [];
  var updatingMarkers = [];

  function handleEvent(event) {
    if (event.typehint === "NewScalaNotesEvent") {
      if (event.isFull) updatingMarkers = [];
      updatingMarkers = updatingMarkers.concat(event.notes.map(toMarker));
    }
    else if (event.typehint === "ClearAllScalaNotesEvent") {
      updatingMarkers = [];
    }
    else if (event.typehint === "FullTypeCheckCompleteEvent") {
      //Typecheck done, now send the markers to the callbacks
      markers = updatingMarkers;
      updatingMarkers = [];
      emitter.emit("markers", markers);
    }
  }

  function handleSave(path) {
    //Force a check the file
    console.info("Forcing typecheck of " + path);
    executeEnsime({
      typehint: "TypecheckFileReq",
      fileInfo: {
        file: handler.workspaceDir + path,
      }
    }, function() {
      //ignore, we wait for typecheck to complete
    });
  }

  function toMarker(note) {
    var res = {
      pos: {
        sl: note.line - 1,
        sc: note.col,
        el: note.line - 1,
        ec: note.col
      },
      type: serverityToType(note.severity),
      message: note.msg
    };
    if (note.file.indexOf(handler.workspaceDir) == 0) {
      res.file = note.file.substr(handler.workspaceDir.length);
    }
    else {
      console.warn("File not in workspace: " + note.file + " (workspaceDir is " + handler.workspaceDir + ")");
      res.file = note.file;
    }
    res.fileFull = note.file;
    return res;
  }

  function serverityToType(severity) {
    switch (severity.typehint) {
      case "NoteInfo":
        return "info";
      case "NoteWarn":
        return "warning";
      case "NoteError":
        return "error";
      default:
        return "error";
    }
  }

  function executeEnsime(req, callback) {
    util.executeEnsime(emitter, req, callback);
  }

  handler.analyze = function(doc, ast, options, callback) {
    var file = handler.path;
    var ms = markers.filter(function(m) {
      return m.file === file;
    });
    callback(false, ms);

    if (options.minimalAnalysis) return; //else we do everything twice
    executeEnsime({
      typehint: "TypecheckFileReq",
      fileInfo: {
        file: handler.workspaceDir + handler.path,
        currentContents: true
      }
    }, function(err) {
      if (err)
        console.warn("Error executing typecheck for " + file + ": " + err);
      //ignore, we wait for typecheck to complete
    });
  };
});