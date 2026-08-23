const url = window.location.href;
const regex = /\/cafes\/(\d{8,})\//; // Match the number after "/cafes/" with at least 8 digits
const match = url.match(regex);
console.log(match[1], "d");

const regex2 = /(?<=articles\/)(\d+)/;
const match2 = url.match(regex2);



(function () {
    // Fetch를 가로채는 코드
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);

        // JSON 응답이 아니면(HTML 페이지 이동 등) 파싱을 시도하지 않고 그대로 통과
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
            return response;
        }

        // 응답 복제 (데이터를 읽기 전에 복제해야 함)
        const clonedResponse = response.clone();
        const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

        // 응답 데이터를 JSON으로 파싱
        try {
            const data = await clonedResponse.json();

            // 특정 API URL과 조건에 맞는 데이터일 경우 알림을 띄운다.
            if (requestUrl.includes(`https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${match[1]}/menus/`)) {
                if (data.result.length == 0) {
                    return
                }
                console.log('[Injected] Script Loaded');

                // 페이지가 다 준비되면 이벤트 발송
                let interval = setInterval(() => {
                    if (document.body.querySelector('.board-list')!= null) {
                        const event = new CustomEvent('FROM_PAGE_SCRIPT', { detail: { data: "menus" } });
                        window.dispatchEvent(event);
                        clearInterval(interval);
                    }
                }, 100);

                console.log('변경 감지 완료!');
                console.log("API 응답 데이터:", data);  // 콘솔에 로그 확인
                // 네 정보 정리하는 로직 여기
                
            } else {
                setTimeout(() => {
                    const event = new CustomEvent('FROM_PAGE_SCRIPT', { detail: { data: "comments" } });
                    window.parent.dispatchEvent(event);
                }, 1000);
            }
        } catch (e) {
            console.error('Fetch JSON 파싱 실패:', e);
        }

        return response;
    };
})();
