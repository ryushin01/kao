/**
 * 서울알림체(서울시 공식 파일을 통째로 씀, 굵기마다 약 0.6MB)를 다 받은 뒤 화면을 보여 줍니다.
 * - 받는 동안 관제 신호가 퍼지는 로딩 화면(AppRoot의 .font-loader)을 덮습니다(html[data-fonts="loading"]).
 * - 8초가 지나거나 글꼴을 받지 못하면 글꼴 정의(#font-faces)를 꺼서 늦게 도착해도 글자가 바뀌지 않게 하고, 운영체제 한글 고딕으로 그대로 보여 줍니다.
 * - 자바스크립트가 없으면 data-fonts가 붙지 않아 로딩 화면이 나오지 않습니다.
 */
export const FONT_LOADER_TIMEOUT_MS = 8000

/** 글꼴 정의는 외부 CSS 대신 페이지에 바로 넣어, CSS를 기다리느라 제한 시간 타이머가 늦게 시작하지 않게 합니다. */
export const FONT_FACE_CSS = "@font-face {font-family: 'Seoul Alrim';font-style: normal;font-weight: 400 500;font-display: swap;src: url(\"/fonts/seoul-alrim/SeoulAlrim-Medium.woff2\") format('woff2');unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF;}@font-face {font-family: 'Seoul Alrim';font-style: normal;font-weight: 600 700;font-display: swap;src: url(\"/fonts/seoul-alrim/SeoulAlrim-Bold.woff2\") format('woff2');unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF;}@font-face {font-family: 'Seoul Alrim';font-style: normal;font-weight: 800;font-display: swap;src: url(\"/fonts/seoul-alrim/SeoulAlrim-ExtraBold.woff2\") format('woff2');unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7A3, U+D7B0-D7FF;}"

export const FONT_FILES = ['Medium', 'Bold', 'ExtraBold'].map((w) => `/fonts/seoul-alrim/SeoulAlrim-${w}.woff2`)

export const FONT_LOADER_SCRIPT = `(function(){var d=document.documentElement,f=document.fonts;var end=false;function done(ok){if(end)return;end=true;if(!ok){var s=document.getElementById('font-faces');if(s)s.disabled=true}d.dataset.fonts='ready'}if(!f||!f.load){done(true);return}d.dataset.fonts='loading';var t=setTimeout(function(){done(false)},${FONT_LOADER_TIMEOUT_MS});Promise.all(['500 1em "Seoul Alrim"','700 1em "Seoul Alrim"','800 1em "Seoul Alrim"'].map(function(w){return f.load(w,'가')})).then(function(){clearTimeout(t);done(true)},function(){clearTimeout(t);done(false)})})()`
