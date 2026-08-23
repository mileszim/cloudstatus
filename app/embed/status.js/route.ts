import { getSettings } from "@/lib/status/settings";

/**
 * Drop-in banner for your own site:
 *
 *   <script src="https://status.example.com/embed/status.js" defer></script>
 *
 * The script fetches live status at runtime rather than baking it in, so a
 * cached copy of this file never reports a stale "all clear". It renders
 * nothing while everything is operational.
 */
export async function GET() {
  const settings = await getSettings();
  const origin = JSON.stringify(settings.siteUrl);
  const pageName = JSON.stringify(settings.pageName);

  const script = `(function () {
  var ORIGIN = ${origin};
  var PAGE_NAME = ${pageName};
  var COLORS = {
    none: null,
    maintenance: "#4b7bd4",
    minor: "#c48a12",
    major: "#d4761f",
    critical: "#cf3b32"
  };

  function dismissed(indicator) {
    try {
      return sessionStorage.getItem("cloudstatus-dismissed") === indicator;
    } catch (e) {
      return false;
    }
  }

  function render(status) {
    var color = COLORS[status.indicator];
    if (!color || dismissed(status.indicator)) return;

    var bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;" +
      "align-items:center;gap:10px;padding:10px 16px;font:500 14px/1.4 " +
      "system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;background:" + color + ";" +
      "box-shadow:0 1px 3px rgba(0,0,0,.2)";

    var text = document.createElement("span");
    text.textContent = PAGE_NAME + ": " + status.description;
    text.style.flex = "1";

    var link = document.createElement("a");
    link.href = ORIGIN;
    link.textContent = "View status";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.style.cssText = "color:#fff;text-decoration:underline;white-space:nowrap";

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "\\u00d7";
    close.setAttribute("aria-label", "Dismiss status banner");
    close.style.cssText =
      "background:none;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 4px";
    close.onclick = function () {
      try {
        sessionStorage.setItem("cloudstatus-dismissed", status.indicator);
      } catch (e) {}
      bar.remove();
    };

    bar.appendChild(text);
    bar.appendChild(link);
    bar.appendChild(close);
    document.body.appendChild(bar);
    document.body.style.paddingTop = bar.offsetHeight + "px";
  }

  function load() {
    fetch(ORIGIN + "/api/v2/status.json", { mode: "cors" })
      .then(function (r) { return r.json(); })
      .then(function (data) { if (data && data.status) render(data.status); })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
`;

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
