const modal = document.querySelector(".modal");

function showModal() {
  modal.className = "modal show";
}

// 공통 스위치 바인딩 (댓글 하이라이트 / 게시글마커-댓글 / 게시글마커-좋아요)
function bindSwitch(selector, storageKey) {
  const $el = document.querySelector(selector);

  chrome.storage.local.get([storageKey], function (result) {
    if (result[storageKey]) {
      $el.classList.add("actived-already");
    }
  });

  $el.onclick = () => {
    if ($el.classList.contains("actived-already") && !$el.classList.contains("active")) {
      $el.classList.remove("actived-already");
      $el.classList.add("active");
    }

    $el.classList.toggle("active");

    const isOn = $el.classList.contains("active");
    chrome.storage.local.set({ [storageKey]: isOn });
    showModal();
  };
}

// 댓글 하이라이트 스위치
bindSwitch(".highlightSwitch", "highlight_switch");

// 게시글 마커 - 댓글 남긴 글 표시 스위치
bindSwitch(".commentSwitch", "comment_switch");

// 게시글 마커 - 좋아요 누른 글 표시 스위치
bindSwitch(".likeSwitch", "like_switch");

// ================= 등록된 카페 관리 =================

const DEFAULT_EMOJI = "🧡";

const $cafeUrlInput = document.querySelector(".cafeUrlInput");
const $addCafeBtn = document.querySelector(".addCafeBtn");
const $addCafeError = document.querySelector(".addCafeError");
const $cafeList = document.querySelector(".cafeList");
const $cafeItemTemplate = document.querySelector(".cafeItemTemplate");

function getRegisteredCafes() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["registered_cafes"], (result) => {
      resolve(result.registered_cafes || {});
    });
  });
}

function saveRegisteredCafes(registry) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ registered_cafes: registry }, resolve);
  });
}

function renderCafeList(registry) {
  $cafeList.innerHTML = "";
  const ids = Object.keys(registry);

  if (ids.length === 0) {
    const empty = document.createElement("p");
    empty.className = "emptyHint";
    empty.textContent = "등록된 카페가 없습니다. 위에 카페 링크를 붙여넣고 등록해주세요.";
    $cafeList.appendChild(empty);
    return;
  }

  ids.forEach((cafeId) => {
    const entry = registry[cafeId];
    const node = $cafeItemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.cafeId = cafeId;

    node.querySelector(".cafeName").textContent = entry.name || cafeId;

    const emojiInput = node.querySelector(".cafeEmojiInput");
    const emojiWrap = node.querySelector(".cafeEmojiWrap");
    const currentMarkType = entry.markType || "emoji";

    emojiInput.value = entry.emoji || DEFAULT_EMOJI;
    emojiWrap.classList.toggle("disabled", currentMarkType !== "emoji");
    emojiInput.disabled = currentMarkType !== "emoji";

    const markBtns = node.querySelectorAll(".markTypeBtn");
    markBtns.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.type === currentMarkType);
      btn.onclick = async () => {
        const registryNow = await getRegisteredCafes();
        if (!registryNow[cafeId]) return;
        registryNow[cafeId].markType = btn.dataset.type;
        await saveRegisteredCafes(registryNow);
        showModal();
        renderCafeList(registryNow);
      };
    });

    async function commitEmoji() {
      const registryNow = await getRegisteredCafes();
      if (!registryNow[cafeId]) return;
      const val = emojiInput.value.trim();
      registryNow[cafeId].emoji = val || DEFAULT_EMOJI;
      emojiInput.value = registryNow[cafeId].emoji;
      await saveRegisteredCafes(registryNow);
      showModal();
    }

    emojiInput.addEventListener("blur", commitEmoji);
    emojiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") emojiInput.blur();
    });

    node.querySelector(".removeCafeBtn").onclick = async () => {
      const registryNow = await getRegisteredCafes();
      delete registryNow[cafeId];
      await saveRegisteredCafes(registryNow);
      showModal();
      renderCafeList(registryNow);
    };

    const $refreshBtn = node.querySelector(".refreshCafeBtn");
    $refreshBtn.onclick = async () => {
      const registryNow = await getRegisteredCafes();
      const current = registryNow[cafeId];
      if (!current) return;

      $refreshBtn.disabled = true;
      $refreshBtn.classList.add("spinning");

      chrome.runtime.sendMessage(
        { action: "resolveCafeLink", url: current.url || `https://cafe.naver.com/CafeProfileView.nhn?clubid=${cafeId}` },
        async (response) => {
          $refreshBtn.disabled = false;
          $refreshBtn.classList.remove("spinning");

          if (!response || !response.success) return;

          const registryAfter = await getRegisteredCafes();
          if (!registryAfter[cafeId]) return;
          registryAfter[cafeId].name = response.name;
          await saveRegisteredCafes(registryAfter);
          renderCafeList(registryAfter);
        }
      );
    };

    $cafeList.appendChild(node);
  });
}

getRegisteredCafes().then(renderCafeList);

async function addCafe() {
  const url = $cafeUrlInput.value.trim();
  $addCafeError.textContent = "";
  if (!url) return;

  $addCafeBtn.disabled = true;
  const originalLabel = $addCafeBtn.textContent;
  $addCafeBtn.textContent = "확인 중...";

  chrome.runtime.sendMessage({ action: "resolveCafeLink", url }, async (response) => {
    $addCafeBtn.disabled = false;
    $addCafeBtn.textContent = originalLabel;

    if (chrome.runtime.lastError) {
      $addCafeError.textContent = "확장프로그램과 통신할 수 없습니다. 다시 시도해주세요.";
      return;
    }

    if (!response || !response.success) {
      $addCafeError.textContent = (response && response.error) || "카페를 찾을 수 없습니다.";
      return;
    }

    const registry = await getRegisteredCafes();

    if (registry[response.cafeId]) {
      $addCafeError.textContent = "이미 등록된 카페입니다.";
      return;
    }

    registry[response.cafeId] = {
      url: response.url,
      name: response.name,
      emoji: DEFAULT_EMOJI,
      markType: "emoji",
    };

    await saveRegisteredCafes(registry);
    $cafeUrlInput.value = "";
    showModal();
    renderCafeList(registry);
  });
}

$addCafeBtn.onclick = addCafe;

$cafeUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCafe();
});
