define(function(require, exports, module) {

  var call_id_prefix = "worker";
  var last_call_id = 0;

  function executeEnsime(emitter, req, callback) {
    var reqId = call_id_prefix + (last_call_id++);
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

  module.exports = {
    executeEnsime: executeEnsime,
    posToOffset: posToOffset,
    escapeHtml: escapeHtml
  };
});