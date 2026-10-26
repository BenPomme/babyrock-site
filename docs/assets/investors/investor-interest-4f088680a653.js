(function () {
  "use strict";

  var dialog = document.getElementById("br-investor-dialog");
  var opener = document.querySelector("[data-br-investor-open]");
  var form = document.getElementById("br-investor-form");
  if (!dialog || !opener || !form) return;

  var nameInput = form.elements.namedItem("name");
  var submitButton = form.querySelector('[type="submit"]');
  var closeButton = dialog.querySelector("[data-br-investor-close]");
  var status = document.getElementById("br-investor-status");
  var emailInput = form.elements.namedItem("email");
  var phoneInput = form.elements.namedItem("phone");
  var websiteInput = form.elements.namedItem("website");
  var pending = null;
  var inFlight = false;
  var succeeded = false;
  var MIN_FORM_AGE_MS = 2000;
  var MAX_RETRY_AGE_MS = 23 * 60 * 60 * 1000;
  var GENERIC_ERROR = "We could not send your request. Please try again.";

  function setStatus(message, state) {
    status.textContent = message || "";
    if (state) status.setAttribute("data-state", state);
    else status.removeAttribute("data-state");
  }

  function setBusy(busy) {
    inFlight = busy;
    form.setAttribute("aria-busy", busy ? "true" : "false");
    submitButton.disabled = busy || succeeded;
    submitButton.textContent = busy ? "Sending..." : "Send request";
    closeButton.disabled = busy;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
      "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function valueOf(input) {
    return String(input && input.value ? input.value : "").trim();
  }

  function currentValues() {
    return {
      name: valueOf(nameInput),
      email: valueOf(emailInput),
      phone: valueOf(phoneInput)
    };
  }

  function sameValues(first, second) {
    return first.name === second.name && first.email === second.email && first.phone === second.phone;
  }

  function submissionFor(values) {
    var now = Date.now();
    if (
      pending &&
      sameValues(pending.values, values) &&
      now - pending.startedAt <= MAX_RETRY_AGE_MS
    ) {
      return pending;
    }

    var startedAt = Date.now();
    if (pending && startedAt <= pending.startedAt) startedAt = pending.startedAt + 1;
    var payload = {
      name: values.name,
      email: values.email,
      phone: values.phone,
      website: valueOf(websiteInput),
      startedAt: startedAt,
      requestId: uuid()
    };
    pending = {
      values: values,
      startedAt: startedAt,
      body: JSON.stringify(payload)
    };
    return pending;
  }

  function waitForMinimumAge(startedAt) {
    var remaining = MIN_FORM_AGE_MS - (Date.now() - startedAt);
    if (remaining <= 0) return Promise.resolve();
    return new Promise(function (resolve) { window.setTimeout(resolve, remaining); });
  }

  function resetAfterSuccess() {
    form.reset();
    pending = null;
    succeeded = false;
    setStatus("", null);
    form.querySelectorAll("input").forEach(function (input) {
      input.disabled = false;
    });
    submitButton.disabled = false;
    submitButton.textContent = "Send request";
    closeButton.disabled = false;
  }

  opener.addEventListener("click", function () {
    if (succeeded) resetAfterSuccess();
    setStatus("", null);
    dialog.showModal();
    nameInput.focus();
  });

  closeButton.addEventListener("click", function () {
    if (!inFlight) dialog.close();
  });

  dialog.addEventListener("cancel", function (event) {
    if (inFlight) event.preventDefault();
  });

  dialog.addEventListener("click", function (event) {
    if (event.target === dialog && !inFlight) dialog.close();
  });

  dialog.addEventListener("close", function () {
    if (succeeded) resetAfterSuccess();
    opener.focus();
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (inFlight || succeeded) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    inFlight = true;
    setBusy(true);
    setStatus("Sending...", null);
    var submission = submissionFor(currentValues());

    try {
      await waitForMinimumAge(submission.startedAt);
      var response = await fetch("/api/investor-interest", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: submission.body
      });

      var data = null;
      try { data = await response.json(); } catch (error) {}

      if (response.ok && data && data.ok === true) {
        succeeded = true;
        pending = null;
        inFlight = false;
        form.querySelectorAll("input").forEach(function (input) {
          input.disabled = true;
        });
        submitButton.disabled = true;
        submitButton.textContent = "Sent";
        closeButton.disabled = false;
        form.setAttribute("aria-busy", "false");
        setStatus("Thank you. Your request was received.", "success");
        return;
      }
      setStatus(GENERIC_ERROR, "error");
    } catch (error) {
      setStatus(GENERIC_ERROR, "error");
    } finally {
      if (!succeeded) setBusy(false);
    }
  });
})();
