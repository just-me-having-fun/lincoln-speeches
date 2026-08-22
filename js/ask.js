(function () {
  var form = document.getElementById("ask-form");
  var input = document.getElementById("question");
  var send = document.getElementById("send");
  var thread = document.getElementById("thread");
  var errorBox = document.getElementById("error");
  var history = [];

  function addTurn(who, cls) {
    var turn = document.createElement("article");
    turn.className = "turn " + cls;
    var whoEl = document.createElement("p");
    whoEl.className = "who";
    whoEl.textContent = who;
    var bodyEl = document.createElement("p");
    bodyEl.className = "body";
    turn.appendChild(whoEl);
    turn.appendChild(bodyEl);
    thread.appendChild(turn);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    return bodyEl;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q || send.disabled) return;

    errorBox.style.display = "none";
    input.value = "";
    send.disabled = true;

    addTurn("You", "you").textContent = q;
    var pending = addTurn("Mr. Lincoln", "lincoln pending");

    fetch("/api/lincoln", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.concat([{ role: "user", content: q }]) })
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || "Error " + r.status); });
        return r.json();
      })
      .then(function (data) {
        pending.textContent = data.reply;
        history.push({ role: "user", content: q });
        history.push({ role: "assistant", content: data.reply });
        if (history.length > 16) history = history.slice(-16);
      })
      .catch(function (err) {
        pending.parentNode.remove();
        errorBox.textContent = err.message || "The reply did not arrive. Try again.";
        errorBox.style.display = "block";
        input.value = q;
      })
      .finally(function () {
        send.disabled = false;
        input.focus();
      });
  });
})();
