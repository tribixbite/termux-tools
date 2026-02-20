// Launcher page script — sets the intent URL on the link from query params.
// Kept separate from HTML because MV3 CSP blocks inline scripts.
const params = new URLSearchParams(window.location.search);
const intentUrl = params.get("url");

const link = document.getElementById("launch-link");
if (intentUrl && intentUrl.startsWith("intent:")) {
  link.href = intentUrl;
} else {
  link.textContent = "Error: no intent URL";
  link.style.background = "#da3633";
}
