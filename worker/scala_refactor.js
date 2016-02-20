define(function(require, exports, module) {

  var baseHandler = require("plugins/c9.ide.language/base_handler");
  var workerUtil = require("plugins/c9.ide.language/worker_util");
  var util = require("./util");

  var handler = module.exports = Object.create(baseHandler);
  var emitter;

  var refactorId = 0;
  var defaultImports = /^(scala\.[^.]*|scala\.collection\.immutable.(Map|Set|List|::|Nil)|java\.lang\.[^.]*)$/;

  handler.handlesLanguage = function(language) {
    return language === "scala";
  };

  handler.init = function(callback) {
    emitter = handler.getEmitter();
    console.log("Scala refactor initialized.");

    emitter.on("organiseImports", function(path) {
      organiseImports(path, function(err) {
        if (err) {
          workerUtil.showError("Problem while organising the imports");
          return console.error(err);
        }
      });
    });

    emitter.on("addImport", function(e) {
      addImport(e.path, e.add, function(err) {
        if (err) {
          workerUtil.showError("Problem while adding an import");
          return console.error(err);
        }
      });
    });

    if (!handler.workspaceDir) {
      handler.workspaceDir = "/home/ubuntu/workspace";
      console.warn("WorkspaceDir was undefined in the language handler - setting it to " + handler.workspaceDir);
    }
    callback();
  };

  function executeEnsime(req, callback) {
    util.executeEnsime(emitter, req, callback);
  }

  function executeRefactoring(params, callback) {
    var id = refactorId++;
    executeEnsime({
      typehint: "RefactorReq",
      procId: id,
      params: params,
      interactive: true
    }, function(err, result) {
      if (err) return callback(err);

      if (result.typehint === "RefactorDiffEffect")
        applyDiff(result.diff, callback);
      else if (result.typehint === "RefactorFailure")
        callback("Error in refactoring: " + result.reason);
      else
        callback("Unsupported refactor effect: " + result.typehint);
    });
  }

  function applyDiff(diffFile, callback) {
    workerUtil.execFile("cat", {
      args: [diffFile],
      stdoutEncoding: "utf-8"
    }, function(err, diff) {
      if (err) return callback(err);
      emitter.emit("updateEditor", {
        diff: diff
      });
    });
  }

  handler.getRefactorings = function(doc, ast, pos, options, callback) {
    console.info("Requesting refactorings for " + options.path + ":" + JSON.stringify(pos));

    callback(false, {
      refactoring: ["rename", "organiseImports", "addImport"],
      isGeneric: false
    });
  };

  /** Organize the imports, file must have been saved first. */
  function organiseImports(path, callback) {
    console.info("Will organise the imports for " + path);

    executeRefactoring({
      typehint: "OrganiseImportsRefactorDesc",
      file: handler.workspaceDir + path
    }, callback);
  }


  /** Add an import. The file must have been saved first. */
  function addImport(path, importToAdd, callback) {
    if (defaultImports.test(importToAdd)) {
      console.info(`No need to add ${importToAdd}, it's a default import.`);
      return callback(false);
    }

    console.info(`Will add import ${importToAdd} for ${path}`);

    workerUtil.readFile(path, {
      encoding: "utf-8",
      allowUnsaved: true
    }, function(err, contents) {
      if (err) return callback(err);

      //check if already imported..
      var exp = new RegExp("^\\s*import " + util.escapeRegExp(importToAdd) + "\s*$", "gm");
      if (exp.test(contents)) {
        console.info(`import ${importToAdd} already present, won't add it again.`);
        return callback(false);
      }
      //or with {} syntax
      var parts = /(.+)\.([^.]+)/.exec(importToAdd);
      if (parts) {
        var pkgMatcher = new RegExp("^\s*import " + util.escapeRegExp(parts[1]) + "\.\{(.*)\}\s*$", "gm");
        var pkgs = pkgMatcher.exec(contents);
        if (pkgs) {
          for (var cand of pkgs[1].split(",")) {
            if (/^\s*Source\s*$/.test(cand)) {
              console.info(`import ${importToAdd} already present, won't add it again.`);
              return callback(false);
            }
          }
        }
      }

      executeRefactoring({
        typehint: "AddImportRefactorDesc",
        file: handler.workspaceDir + path,
        qualifiedName: importToAdd
      }, callback);
    });
  }
});