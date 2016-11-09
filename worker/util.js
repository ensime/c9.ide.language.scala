define(function(require, exports, module) {

  var last_call_id = 0;

  function executeEnsime(emitter, req, callback) {
    var reqId = last_call_id++;
    emitter.on("call.result", function hdlr(event) {
      if (event.id !== reqId) return;
      emitter.off("call.result", hdlr);
      callback(event.error, event.result);
    });
    emitter.emit("call", {
      id: reqId,
      request: req,
    });
  }

  /** Do multiple concurrent ensime calls. */
  function executeEnsimes(emitter, reqs, callback) {
    var done = false;
    var results = [];
    var called = [];

    function cb(index) {
      return function(err, r) {
        if (done || called[index]) return;
        if (err) {
          done = true;
          return callback(err);
        }
        results[index] = r;
        called[index] = true;
        for (var i = 0; i < reqs.length; i++) {
          if (!called[i]) return;
        }
        callback(false, results);
      };
    }
    reqs.forEach(function(req, i) {
      executeEnsime(emitter, req, cb(i));
    });
  }

  function posToOffset(doc, pos) {
    return doc.getLines(0, pos.row - 1).reduce(function(sf, l) {
      return sf + l.length + 1;
    }, 0) + pos.column;
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeRegExp(value) {
    return value.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&");
  }

  module.exports = {
    executeEnsime: executeEnsime,
    executeEnsimes: executeEnsimes,
    posToOffset: posToOffset,
    escapeHtml: escapeHtml,
    escapeRegExp: escapeRegExp
  };
});