chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason == "install") {
    console.log("Thank you for download 단이봤!");
    chrome.storage.local.set({
      highlight_switch: true,
      comment_switch: true,
      like_switch: true,
      registered_cafes: {}, // { [cafeId]: { url, name, emoji, markType } }
    });
  }
  if (details.reason == "update") {
    console.log("확장프로그램이 업데이트 되었습니다.");

    /* 
        chrome.tabs.create({
          //패치노트 url
          url: "https://github.com/mauserne/Naver-cafe-Marker/releases",
          selected: true,
          active: true,
        });
         */

    // 캐쉬(카페별 방문/좋아요 기록)만 초기화. 등록한 카페 목록/설정은 유지!
    dumpData();
  }
});

function dumpData() {
  chrome.storage.local.get(null, function (data) {
    const knownKeys = ["highlight_switch", "comment_switch", "like_switch", "registered_cafes"];
    const keysToRemove = Object.keys(data).filter((k) => !knownKeys.includes(k));

    chrome.storage.local.remove(keysToRemove, function () {
      console.log("방문 캐시 초기화 완료! (등록한 카페와 설정은 유지됩니다)");

      chrome.storage.local.get(["highlight_switch", "comment_switch", "like_switch", "registered_cafes"], (result) => {
        const patch = {};
        if (result.highlight_switch === undefined) patch.highlight_switch = true;
        if (result.comment_switch === undefined) patch.comment_switch = true;
        if (result.like_switch === undefined) patch.like_switch = true;
        if (result.registered_cafes === undefined) patch.registered_cafes = {};
        if (Object.keys(patch).length) {
          chrome.storage.local.set(patch);
        }
      });
    });
  });
}

chrome.storage.local.getBytesInUse(null, function (bytes) {
  let kb = bytes / 1024;
  let mb = kb / 1024;
  console.log(
    "Local storage used by extension: " + kb.toFixed(2) + " kB, " + mb.toFixed(2) + " MB"
  );
});

// ================= 카페 링크 -> 카페 ID 해석 =================

function extractCafeNameFromHtml(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  if (m) {
    return m[1].replace(/\s*:\s*네이버\s*카페\s*$/, "").trim();
  }
  return null;
}

// ---- 인코딩 자동 판별 ----
// 네이버 카페 관련 페이지들은 엔드포인트마다 EUC-KR/UTF-8이 섞여있어서,
// 둘 다 디코딩해본 뒤 "깨지지 않은" 쪽을 자동으로 고른다.
function looksGarbled(str) {
  if (!str) return true;
  if (/\uFFFD/.test(str)) return true; // 디코딩 실패시 나타나는 대체 문자(U+FFFD)
  // EUC-KR을 UTF-8로(혹은 그 반대로) 잘못 해석하면 라틴 확장/기호 영역 문자가 연속으로 뭉쳐 나온다
  const suspicious = (str.match(/[\u0080-\u00FF\u2010-\u2BFF]/g) || []).length;
  return suspicious > str.length * 0.12;
}

function hangulRatio(str) {
  const hangul = (str.match(/[\uAC00-\uD7A3]/g) || []).length;
  const total = str.replace(/\s/g, "").length || 1;
  return hangul / total;
}

function pickBetterDecoded(a, b) {
  const aGarbled = looksGarbled(a);
  const bGarbled = looksGarbled(b);
  if (aGarbled && !bGarbled) return b;
  if (!aGarbled && bGarbled) return a;
  return hangulRatio(a) >= hangulRatio(b) ? a : b;
}

function decodeBufferSmart(buffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  let euckr = "";
  try {
    euckr = new TextDecoder("euc-kr").decode(buffer);
  } catch (e) {
    return utf8;
  }
  return pickBetterDecoded(utf8, euckr);
}

async function fetchTextSmart(url, options) {
  const resp = await fetch(url, options);
  const buffer = await resp.arrayBuffer();
  return decodeBufferSmart(buffer);
}

async function fetchCafeName(cafeId, fallbackName) {
  try {
    const decoded = await fetchTextSmart(`https://cafe.naver.com/CafeProfileView.nhn?clubid=${cafeId}`);
    const name = extractCafeNameFromHtml(decoded);
    if (name) return name;
  } catch (e) {
    console.warn("카페 이름 조회 실패", e);
  }
  return fallbackName;
}

async function resolveCafeId(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl.trim());
  } catch (e) {
    throw new Error("올바른 URL 형식이 아닙니다.");
  }

  if (!/(^|\.)cafe\.naver\.com$/.test(url.hostname)) {
    throw new Error("네이버 카페(cafe.naver.com) 링크만 등록할 수 있습니다.");
  }

  // 1) URL 경로에 clubid가 바로 포함된 경우 (예: /ca-fe/cafes/12345678/articles/1)
  let m = url.pathname.match(/\/cafes\/(\d{4,})/);
  if (m) {
    const cafeId = m[1];
    const name = await fetchCafeName(cafeId, url.href);
    return { cafeId, name, url: url.href };
  }

  // 2) 쿼리스트링에 clubid가 포함된 경우 (구버전 링크)
  const clubidParam = url.searchParams.get("clubid");
  if (clubidParam) {
    const cafeId = clubidParam;
    const name = await fetchCafeName(cafeId, url.href);
    return { cafeId, name, url: url.href };
  }

  // 3) 카페 대문/닉네임 URL인 경우 -> 페이지를 직접 요청해서 clubid 추출
  const html = await fetchTextSmart(url.href, { credentials: "include" });

  const patterns = [
    /"clubId"\s*:\s*"?(\d{4,})"?/,
    /g_sClubId\s*=\s*['"](\d{4,})['"]/,
    /clubid=(\d{4,})/i,
    /cafes\/(\d{4,})\//,
  ];

  for (const p of patterns) {
    const found = html.match(p);
    if (found) {
      const cafeId = found[1];
      let name = extractCafeNameFromHtml(html);
      if (!name || looksGarbled(name)) {
        // 대문 페이지에서 이름 추출이 애매하면 CafeProfileView(EUC-KR 전용 레거시 페이지)에서 재시도
        name = await fetchCafeName(cafeId, name || url.pathname.replace(/^\//, "") || url.href);
      }
      return { cafeId, name, url: url.href };
    }
  }

  throw new Error("카페 ID를 찾을 수 없습니다. 카페 메인 페이지 링크로 다시 시도해주세요.");
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(
    sender.tab ? "from a content script:" + sender.tab.url : "from the extension"
  );

  if (request.action === "resolveCafeLink" && request.url) {
    resolveCafeId(request.url)
      .then((result) => {
        sendResponse({ success: true, ...result });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 비동기 응답
  }

  if (request.cafeId && request.ownerKey && request.article_list) {
    const cafeId = request.cafeId;
    const fetchPromise = new Promise((resolve, reject) => {
      const fetchList = request.article_list.map((el) => {
        console.log(el, "게시물 확인 중..");
        return fetch(
          `https://apis.naver.com/cafe-web/cafe-articleapi/v2/cafes/${request.cafeId}/articles/${el}/comments`
        )
          .then((response) => response.json())
          .then((data) => {
            console.log(data);
            const commented = JSON.stringify(data.result.comments.items).includes(
              request.ownerKey
            );
            const liked = JSON.stringify(data.result.likeItUsers).includes(
              request.ownerKey
            );
            if (commented || liked) {
              console.log(el, "게시물에 주인확인");
              return { id: el, commented: commented, liked: liked };
            }
          })
          .catch((error) => {
            reject(error);
          });
      });
      Promise.all(fetchList)
        .then((results) => {
          console.log(results);
          // 모든 API 요청이 완료되었을 때 실행되는 코드
          const filteredArr = results.filter((item) => {
            return item !== undefined;
          });
          resolve(filteredArr); // 각 API 요청의 처리 결과가 담긴 배열
          // 결과 처리 코드 작성
        })
        .catch((error) => {
          sendResponse({ error: error.message });
        });
    });

    fetchPromise.then((responseData) => {
      chrome.storage.local.get(null, function (data) {
        console.log('All Data', data);
      })
      sendResponse({ data: responseData });
      chrome.storage.local.get([cafeId], (result) => {
        if (!result[cafeId]) {
          chrome.storage.local.set({
            [cafeId]: responseData
          });
        } else {
          chrome.storage.local.set({
            [cafeId]: result[cafeId].concat(responseData)
          });
        }
      });
      console.log("sending to content-script", responseData);
    });

    return true;
  }
});
