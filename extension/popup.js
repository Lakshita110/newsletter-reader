const input = document.getElementById("baseUrl");
const button = document.getElementById("save");

chrome.storage.local.get(["readerBaseUrl"], (result) => {
  if (result.readerBaseUrl) input.value = result.readerBaseUrl;
});

button.addEventListener("click", () => {
  const url = input.value.trim();
  if (url) chrome.storage.local.set({ readerBaseUrl: url });
  button.textContent = "Saved ✓";
  setTimeout(() => { button.textContent = "Save"; }, 1500);
});
