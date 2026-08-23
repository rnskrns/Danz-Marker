// 마킹 스타일(이모지 / 제목 회색)을 위한 공통 스타일 주입
(function injectMarkerStyle() {
  const style = document.createElement("style");
  style.setAttribute("data-ncm", "marker-style");
  style.textContent = `
    .ncm-gray-marker { color: #a0a0a0 !important; }
    .ncm-gray-marker:visited { color: #b8b8b8 !important; }
    .ncm-gray-thumb { filter: grayscale(100%); opacity: 0.55; }
  `;
  (document.head || document.documentElement).appendChild(style);
})();

function difference_Set(a, b) {
  return new Set([...a].filter((x) => !b.has(x)));
}

function union_Set(a, b) {
  return new Set([...a, ...b]);
}

function extract_info() {
  var o_page = document.body.querySelector('[class*="Sidebar_nickname"]');

  if (o_page == null) {
    o_page = document.body.querySelector(".id.mlink.gm-tcol-c");
  }

  var ownerN = o_page.innerText;
  console.log(o_page, 'd');
  console.log(o_page.href);
  var tmp = o_page.href.lastIndexOf("/");

  const url = o_page.href;
  const regex = /\/cafes\/(\d{8,})\//; // Match the number after "/cafes/" with at least 8 digits
  const match = url.match(regex);

  
  if (!match) {
    console.log("No cafe ID found - Naver cafe marker");
  }
  
  return [ownerN, o_page.href.substr(tmp + 1), match[1]];
}
let article_table;

function wait_iframeCreated() {
  return new Promise((resolve) => {
    const checkIframeCreated = () => {
      article_table = document.body.querySelector('.article-table');
      if (article_table) {
        iframe_manipulate();
        resolve(article_table);
      } else {
        setTimeout(checkIframeCreated, 500);
        console.log('아티클테이블 재탐색');
        
      }
    };
    checkIframeCreated();
  });
}

const [ownerName, ownerKey, cafeId] = extract_info();

// 등록된 카페인지, 그리고 이 카페에 설정된 마킹 방식(이모지/제목 회색)과 이모지
let category_valid = false; // 기본값: 등록되지 않은 카페 = 비활성화
let cafeConfig = { emoji: "🧡", markType: "emoji" };

function loadCafeConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["registered_cafes"], (result) => {
      const registry = result.registered_cafes || {};
      const entry = registry[cafeId];
      if (entry) {
        category_valid = true;
        cafeConfig = {
          emoji: entry.emoji || "🧡",
          markType: entry.markType || "emoji",
        };
      } else {
        category_valid = false;
      }
      resolve();
    });
  });
}

// 팝업에서 카페 등록 정보를 바꾸면 새로고침 없이도 최신값을 반영
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.registered_cafes) {
    loadCafeConfig();
  }
});

let cooldown = 0;

setInterval(() => {
  cooldown = 0;
}, 1000 * 60 * 2);

window.addEventListener('FROM_PAGE_SCRIPT', (event) => {
  console.log('[Content Script] 받은 메시지:', event.detail);
  if (event.detail.data == "menus") {
    iframe_manipulate();

    if (cooldown > 150) {
      cooldown = 0;
      alert(
        '"🧡게시글 마커" 활성화 상태에서 단시간에 대량의 글을 탐색하면, 일시적으로 카페 이용이 거부될 수 있습니다.'
      );
    }
  }
});

window.addEventListener('FROM_PAGE_SCRIPT', (event) => {
  console.log('[Content Script] 받은 메시지:', event.detail);
  if (event.detail.data == "comments") {
    chrome.storage.local.get(["highlight_switch"], function (result) {
      //댓글 하이라이트 toggle
      setTimeout(() => {

        console.log('nhow1s');
        if (result.highlight_switch) {
          waitForThumbs()
            .then((thumbs) => {
              highlight_reply(thumbs);
              console.log('nhows');

            })
            .catch((error) => {
              console.error(error);
            });
        }
      },2000);
    });
  }
});

const getVisited = () => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([cafeId], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        // result[cafeId]: [{id, commented, liked}, ...] (예전 버전 캐시는 업데이트시 초기화됨)
        const list = result[cafeId] || [];
        resolve(new Map(list.map((item) => [item.id, item])));
      }
    });
  });
};

function callAPIAsync(params) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { ownerKey: ownerKey, cafeId: cafeId, article_list: params },
      function (response) {
        resolve(response.data);
      }
    );
  });
}

function highlight_reply(thumbs) {
  thumbs.forEach((el) => {
    if (el.href.includes(ownerKey)) {
      el.parentNode.parentNode.style.backgroundColor = "cornsilk";
      el.parentNode.parentNode.className =
        el.parentNode.parentNode.className + " CafeOwner";
    }
  });
}

let dont_update = new Set(); //하트가 안달린 글을 새로고침 전까지 다시 탐색하지 않음(최적화)



function heart_marker(i_article, i_albumimg, current_display_articles) {
  console.log('dasdas');
  getVisited()
    .then((visited_map) => {
      let willupdate = difference_Set(
        new Set([...current_display_articles]),
        new Set(visited_map.keys())
      );

      callAPIAsync([...difference_Set(willupdate, dont_update)])
        .then((replied_list) => {
          const replied_map = new Map(replied_list.map((item) => [item.id, item]));

          chrome.storage.local.get(["comment_switch", "like_switch"], (settings) => {
            const commentOn = settings.comment_switch !== false; // 기본값 true
            const likeOn = settings.like_switch !== false; // 기본값 true
            const markType = cafeConfig.markType || "emoji"; // "emoji" | "gray"
            const heartEmoji = cafeConfig.emoji || "🧡"; // 이 카페에 등록된 이모지

            const shouldMark = (id) => {
              const entry = replied_map.get(id) || visited_map.get(id);
              if (!entry) return false;
              return (entry.commented && commentOn) || (entry.liked && likeOn);
            };

            i_article.forEach((article) => {
              const idMatch = article.href && article.href.match(/(?<=articles\/)(\d+)/);
              if (!idMatch) return;
              var articleId = idMatch[0];
              if (shouldMark(articleId)) {
                if (markType === "gray") {
                  article.classList.add("ncm-gray-marker");
                } else if (!article.parentNode.querySelector(".ncm-heart-marker")) {
                  if (window.getComputedStyle(article).display == "table-cell") {
                    article.parentNode.insertAdjacentHTML(
                      "beforeend",
                      `<span class="ncm-heart-marker" style='display: table-cell'>${heartEmoji}</span>`
                    );
                  } else {
                    article.parentNode.insertAdjacentHTML(
                      "beforeend",
                      `<span class="ncm-heart-marker">${heartEmoji}</span>`
                    );
                  }
                }
              }
            });

            i_albumimg.forEach((img) => {
              const idMatch = img.href && img.href.match(/(?<=articles\/)(\d+)/);
              if (!idMatch) return;
              var imgId = idMatch[0];
              if (shouldMark(imgId)) {
                if (markType === "gray") {
                  img.classList.add("ncm-gray-thumb");
                } else if (!img.querySelector(".ncm-heart-marker")) {
                  img.insertAdjacentHTML(
                    "beforeend",
                    `<span class="ncm-heart-marker" style='position: absolute; font-size: 25px; text-shadow: 0px 0px 3px rgba(95, 95, 95, 0.5); left: 1%; bottom: 90%;'>${heartEmoji}</span>`
                  );
                }
              }
            });
          });
        })
        .catch((error) => {
          console.error(error);
        });

      past_tmp = [...dont_update].length;
      dont_update = union_Set(dont_update, willupdate);
      cooldown += cooldown_Counter(past_tmp, [...dont_update].length);
    })
    .catch((error) => {
      console.error(error);
    });
}

function cooldown_Counter(past, now) {
  if (past >= now) {
    return 0;
  } else {
    return now - past;
  }
}

let timeout = null;

const targetNode = document.querySelector("#cafe_content"); // 혹은 변동이 일어나는 구체적인 요소

const originalFetch = window.fetch;

function iframe_manipulate() {
  if (!category_valid) {
    console.log(
      category_valid,
      "단이봤: 등록되지 않은 카페입니다. 확장프로그램 팝업에서 이 카페 링크를 등록해주세요."
    );
    return false;
  }

  if (!targetNode) {
    return false;
  }

  console.log("iframe 로드 완료!1 - Naver cafe marker");
  let current_display_articles = [];
  
  let i_article = targetNode.querySelectorAll(".article");
  let i_albumimg = targetNode.querySelectorAll(".thumbLink");





  i_article.forEach((article) => {
    const idMatch = article.href && article.href.match(/(?<=articles\/)(\d+)/);
    if (!idMatch) return;
    current_display_articles.push(idMatch[0]);
  });

  i_albumimg.forEach((albumimg) => {
    const idMatch = albumimg.href && albumimg.href.match(/(?<=articles\/)(\d+)/);
    if (!idMatch) return;
    current_display_articles.push(idMatch[0]);
  });



  chrome.storage.local.get(["comment_switch", "like_switch"], function (result) {
    //게시글 마커(댓글/좋아요) toggle 체크
    const commentOn = result.comment_switch !== false; // 기본값 true
    const likeOn = result.like_switch !== false; // 기본값 true
    if (commentOn || likeOn) {
      heart_marker(i_article, i_albumimg, current_display_articles);
    }
  });
}

var s = document.createElement("script");
s.src = chrome.runtime.getURL("script.js");
s.onload = function () {
  this.remove();
};
(document.head || document.documentElement).appendChild(s);

// ================= 페이지 이동 / 뒤로가기 대응 =================
// 네이버 카페는 메뉴 이동이나 뒤로가기 시 문서를 새로 로드하지 않고
// 화면 내용만 스크립트로 갈아끼우는 경우가 많다.
// 1) 게시글 목록 영역(article-table)의 DOM이 바뀌는 것을 감시하고
// 2) history.pushState/replaceState, popstate(뒤로/앞으로 가기)를 감지해서
// 새로고침 없이도 마커가 다시 적용되도록 한다.

let manipulateDebounceTimer = null;
function scheduleIframeManipulate(delay = 250) {
  clearTimeout(manipulateDebounceTimer);
  manipulateDebounceTimer = setTimeout(() => {
    iframe_manipulate();
  }, delay);
}

function observeArticleListChanges() {
  if (!targetNode) return;

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      const target = m.target;
      if (
        target.nodeType === 1 &&
        target.classList &&
        (target.classList.contains("article-table") || target.closest(".article-table"))
      ) {
        return true;
      }
      return [...m.addedNodes].some(
        (n) =>
          n.nodeType === 1 &&
          (n.matches?.(".article-table") || n.querySelector?.(".article-table") || n.matches?.(".article, .thumbLink"))
      );
    });

    if (relevant) {
      scheduleIframeManipulate();
    }
  });

  observer.observe(targetNode, { childList: true, subtree: true });
}

function observeUrlChanges() {
  let lastUrl = location.href;

  const handleUrlChange = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // 목록이 다시 그려질 시간을 준 뒤 마커를 재적용
      scheduleIframeManipulate(500);
    }
  };

  window.addEventListener("popstate", handleUrlChange); // 뒤로가기 / 앞으로가기
  window.addEventListener("hashchange", handleUrlChange);

  const wrapHistoryMethod = (methodName) => {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      handleUrlChange();
      return result;
    };
  };
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
}

function waitForIframeDoc(selector = "#cafe_main", timeout = 5000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const iframe = document.body.querySelector(selector);
      if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
        resolve(iframe.contentWindow.document);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error("iframe document not available within timeout"));
      } else {
        setTimeout(check, 200); // 200ms 단위로 다시 체크
      }
    };

    check();
  });
}


const waitForThumbs = async () => {
  let st = document.createElement("style");
  st.innerText = `
    .CommentItem.CafeOwner::before {
      width: 858px;
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: -29px;
      border-radius: 25px;
      right: -29px;
      background-color: cornsilk;
    }
    
    .CommentItem.CommentItem--reply.CafeOwner  {
      padding-left: 0 !important;
      margin-left: 46px;
    }
    `;

  try {
    const iframeDoc = await waitForIframeDoc();
    iframeDoc.head.appendChild(st);

    return new Promise((resolve) => {
      const thumbs = iframeDoc.querySelectorAll(".comment_thumb");
      if (thumbs.length > 0) {
        resolve(thumbs);
      } else {
        const intervalId = setInterval(() => {
          const updatedThumbs = iframeDoc.querySelectorAll(".comment_thumb");
          if (updatedThumbs.length > 0) {
            clearInterval(intervalId);
            resolve(updatedThumbs);
          }
        }, 1000);
      }
    });
  } catch (err) {
    console.error("iframe 로딩 실패:", err);
    throw err;
  }
};


loadCafeConfig().then(() => {
  wait_iframeCreated().then(() => {
    iframe_manipulate();
    observeArticleListChanges();
    observeUrlChanges();
  });
});