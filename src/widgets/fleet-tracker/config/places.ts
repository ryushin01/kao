/** 관제 지도에 이름을 띄우는 곳. 길을 찾는 데 도움이 되는 몇 곳만 둡니다(꾸밈용이라 보조기기에서는 숨김). */
export const MAP_PLACES: ReadonlyArray<{ id: string; name: string; lat: number; lng: number }> = [
  { id: 'gwanghwamun', name: '광화문', lat: 37.5759, lng: 126.9769 },
  { id: 'city-hall', name: '서울시청', lat: 37.5663, lng: 126.9779 },
  { id: 'seoul-station', name: '서울역', lat: 37.5547, lng: 126.9707 },
  { id: 'namsan', name: '남산서울타워', lat: 37.5512, lng: 126.9882 },
  { id: 'itaewon', name: '이태원', lat: 37.5345, lng: 126.9946 },
  { id: 'yongsan', name: '용산', lat: 37.5299, lng: 126.9648 },
  { id: 'han-river', name: '한강', lat: 37.5236, lng: 126.9455 },
  { id: 'nodeul', name: '노들섬', lat: 37.5176, lng: 126.9586 },
  { id: 'yeouido', name: '여의도', lat: 37.5253, lng: 126.9282 },
  { id: 'banpo', name: '반포대교', lat: 37.5143, lng: 126.9966 },
  { id: 'hannam', name: '한남대교', lat: 37.5262, lng: 127.0128 },
  { id: 'dongjak', name: '동작대교', lat: 37.5115, lng: 126.9822 },
]
