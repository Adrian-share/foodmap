(() => {
  'use strict';
  const {normalize} = samples;
  const byId = id => document.getElementById(id);
  const query = byId('query'), status = byId('status'), list = byId('results');
  const candidates = byId('candidates'), preview = byId('preview'), mapElement = byId('map');
  const mapStatus = byId('map-status'), retrySearch = byId('retry-search'), retryMap = byId('retry-map');
  const fitMap = byId('fit-map'), more = byId('load-more'), creator = byId('creator-filter');
  const empty = byId('empty-state'), currentOrigin = byId('current-origin');
  let selectedId, nextOffset, controller;
  let config = {searchEnabled: false, mapEnabled: false};
  let map, markers = [], infoWindow, current;
  let searchVersion = 0, sdkVersion = 0, connecting = false, lastInput = '王府井';

  function link(label, url) {
    const anchor = document.createElement('a');
    anchor.textContent = label;
    anchor.href = url;

    anchor.rel = 'noopener noreferrer';
    return anchor;
  }
  function details(shop, container) {
    const title = document.createElement('strong');
    title.textContent = shop.name + ' · ' + (shop.meters / 1000).toFixed(2) + ' km';
    const address = document.createElement('p');
    address.textContent = shop.address;
    container.append(title, address, link('探店记录', shop.detail_url || '/content/?bvid=' + (shop.video?.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
    if (shop.video) container.append(link('相关 B 站视频', shop.detail_url || '/content/?bvid=' + (shop.video.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
  }
  function highlight() {
    Array.from(list.children).forEach(item => item.setAttribute('aria-current', String(item.dataset.storeId === selectedId)));
    mapElement.querySelectorAll('.map-pin:not(.origin)').forEach(pin => pin.setAttribute('aria-pressed', String(pin.dataset.storeId === selectedId)));
  }
  function selectShop(index) {
    const shop = current?.shops[index];
    if (!shop) return;
    selectedId = shop.id || shop.name;
    highlight();
    list.children[index]?.scrollIntoView({block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    if (!map || !markers[index + 1]) return;
    map.panTo?.([shop.lng, shop.lat]);
    infoWindow?.close();
    const content = document.createElement('div');
    content.className = 'shop-info';
    details(shop, content);
    infoWindow = new AMap.InfoWindow({content, offset: new AMap.Pixel(0, -32), autoMove: false});
    infoWindow.open(map, markers[index + 1].getPosition());
  }
  function showList(shops, start = 0) {
    shops.forEach((shop, i) => list.append(FoodmapHomeCards.render(shop, start + i, () => selectShop(start + i))));
  }
  function emptyState(message) {
    empty.hidden = false;
    byId('empty-message').textContent = message;
    byId('result-count').textContent = '暂无匹配结果';
  }
  function showSketch(origin, shops) {
    preview.replaceChildren();
    const points = [origin, ...shops];
    const left = Math.min(...points.map(item => item.lng));
    const right = Math.max(...points.map(item => item.lng));
    const bottom = Math.min(...points.map(item => item.lat));
    const top = Math.max(...points.map(item => item.lat));
    const longitudeScale = Math.cos(origin.lat * Math.PI / 180);
    const scale = Math.min(460 / ((right - left) * longitudeScale || 1), 260 / (top - bottom || 1));
    const x = item => 300 + (item.lng - (left + right) / 2) * longitudeScale * scale;
    const y = item => 182 - (item.lat - (bottom + top) / 2) * scale;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 600 365');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '离线位置示意，非真实底图，数字与列表对应');
    function shape(tag, attrs, label) {
      const element = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      if (label !== undefined) element.textContent = label;
      svg.append(element);
      return element;
    }
    for (const shop of shops) {
      shape('line', {x1:x(origin), y1:y(origin), x2:x(shop), y2:y(shop), stroke:'#85a598', 'stroke-dasharray':'5 5'});
    }
    points.forEach((item, index) => {
      const circle = shape('circle', {cx:x(item), cy:y(item), r:15, fill:index ? '#137664' : '#173d6b', stroke:'#fff', 'stroke-width':2});
      const text = shape('text', {x:x(item), y:y(item)+5, fill:'#fff', 'text-anchor':'middle', 'font-size':13}, index || '起');
      if (index) for (const element of [circle, text]) element.addEventListener('click', () => selectShop(index - 1));
    });
    shape('text', {x:20,y:30,fill:'#345753','font-size':14}, '离线位置示意 · 非真实底图 · 北 ↑');
    preview.append(svg);
  }
  function clear() {
    current = undefined;
    selectedId = undefined;
    nextOffset = null;
    more.hidden = true;
    empty.hidden = true;
    byId('list-end').hidden = true;
    list.replaceChildren();
    candidates.replaceChildren();
    preview.replaceChildren();
    infoWindow?.close();
    infoWindow = undefined;
    if (map && markers.length) map.remove(markers);
    markers = [];
    retrySearch.hidden = true;
    fitMap.hidden = !map;
  }
  function fit() {
    if (map && markers.length) map.setFitView(markers, true, [65, 85, 65, 85]);
  }
  function showMap() {
    if (!map || !current) return;
    if (markers.length) map.remove(markers);
    markers = [current.origin, ...current.shops].map((item, index) => {
      const content = document.createElement('button');
      content.type = 'button';
      content.className = 'map-pin' + (index ? '' : ' origin');
      content.textContent = index ? String(index) : '起';
      content.setAttribute('data-marker-index', String(index));
      content.setAttribute('data-store-id', item.id || item.name);
      content.setAttribute('aria-label', (index ? index + ' · ' : '起点 · ') + item.name);
      const marker = new AMap.Marker({position: [item.lng, item.lat], content, anchor: 'center', title: item.name});
      if (index) {
        // 自定义内容是原生按钮，直接处理点击，同时保留原生键盘激活。
        content.addEventListener('click', event => {
          event.stopPropagation();
          selectShop(index - 1);
        });
      }
      return marker;
    });
    map.add(markers);
    highlight();
    fit();
    fitMap.hidden = false;
  }
  function render(result, version, append) {
    if (version !== searchVersion) return;
    if (!append) clear();
    const {origin, results: shops} = result;
    const start = current?.shops.length || 0;
    const seen = new Set(current?.shops.map(s => s.id || s.name));
    const added = shops.filter(s => !seen.has(s.id || s.name));
    current = {origin, shops: [...(current?.shops || []), ...added]};
    list.dataset.version = result.data_version;
    document.body.dataset.catalogVersion = result.data_version;
    showList(added, start);
    nextOffset = result.next_offset ?? null;
    more.hidden = nextOffset === null;
    byId('list-end').hidden = nextOffset !== null || !current.shops.length;
    byId('result-count').textContent = `${result.total ?? current.shops.length} 家探店 · 已展示 ${current.shops.length} 家 · 按直线距离排序`;
    currentOrigin.textContent = origin.name;
    const selectedCreator = creator.value;
    if (result.creators) {
      creator.replaceChildren(new Option('全部博主', ''));
      for (const item of result.creators) creator.add(new Option(item.name, item.id));
      // Keep a selected filter visible even if a later catalog has no matching visits.
      if (selectedCreator && !result.creators.some(c => c.id === selectedCreator)) creator.add(new Option(selectedCreator, selectedCreator));
      creator.value = selectedCreator;
    }
    if (map) showMap(); else showSketch(origin, current.shops);
    for (const chip of document.querySelectorAll('[data-origin]')) chip.setAttribute('aria-pressed', String(origin.name === chip.dataset.origin + '地铁站'));
    if (!current.shops.length) emptyState('当前起点没有符合这位博主的收录门店。可清除筛选，查看全部探店。');
    status.textContent = result.message + ' · ' + result.scope;
  }
  function validOrigin(item) {
    return item && typeof item.name === 'string' && Number.isFinite(item.lng) && Number.isFinite(item.lat)
      && item.lng >= 115.4 && item.lng <= 117.6 && item.lat >= 39.4 && item.lat <= 41.1;
  }
  async function search(input = query.value, originId, append = false) {
    if (append && (!current || nextOffset === null || more.disabled)) return;
    const offset = append ? nextOffset : 0;
    lastInput = input;
    const version = ++searchVersion;
    controller?.abort();
    controller = new AbortController();
    const name = normalize(input);
    if (!append) {clear(); currentOrigin.textContent = '正在定位…'; byId('result-count').textContent = '正在查找附近探店…';}
    byId('clear-filter').hidden = !creator.value;
    byId('filter-state').textContent = creator.selectedOptions[0]?.textContent || '全部博主';
    if (!name) {status.textContent = '请输入地点名称。'; currentOrigin.textContent = '未选择地点'; emptyState('输入北京的地铁站、酒店或地标开始探索。'); return;}
    status.textContent = append ? '正在加载更多探店…' : '正在搜索地点与附近探店…';
    list.setAttribute('aria-busy', 'true');
    more.disabled = true;
    try {
      const params = new URLSearchParams({location: name, city: '北京', limit: '6', offset: String(offset)});
      if (originId) params.set('origin_id', originId);
      if (creator.value) params.set('creator', creator.value);
      const response = await fetch('/api/nearby?' + params, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])});
      const result = await response.json();
      if (version !== searchVersion) return;
      if (!response.ok || !Array.isArray(result.results)) throw Error('搜索失败');
      if (result.status === 'ok') {
        if (!validOrigin(result.origin) || !result.results.every(s => validOrigin(s) && Number.isFinite(s.meters))) throw Error('搜索失败');
        // A changed catalog cannot safely be appended to an older ordering.
        if (append && result.data_version !== list.dataset.version) {more.disabled = false; return search(input, originId);}
        render(result, version, append); return;
      }
      status.textContent = result.message;
      currentOrigin.textContent = result.candidates?.length ? '请选择准确起点' : '未找到地点';
      emptyState(result.message);
      for (const poi of result.candidates || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = poi.name + (poi.address ? ' · ' + poi.address : '');
        button.addEventListener('click', () => {if (version === searchVersion) search(input, poi.id);});
        candidates.append(button);
      }
    } catch {
      if (version !== searchVersion) return;
      status.textContent = '地点与附近探店检索失败，请重试搜索。';
      if (!append) {clear(); currentOrigin.textContent = '定位失败'; emptyState('暂时无法读取探店结果，请重试搜索。');}
      retrySearch.hidden = false;
    } finally {
      if (version === searchVersion) {list.setAttribute('aria-busy', 'false'); more.disabled = false;}
    }
  }
  function loadSDK(key) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const callback = 'initializeAMap' + (++sdkVersion);
      let finished = false;
      const timer = setTimeout(() => finish(Error('SDK 超时')), 12000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // 保留空回调，忽略超时后到达的旧脚本。
        window[callback] = () => {};
        script.remove();
        if (error) reject(error);
        else resolve();
      }
      window[callback] = () => finish(window.AMap ? undefined : Error('SDK 不可用'));
      script.onerror = () => finish(Error('SDK 加载失败'));
      script.src = 'https://webapi.amap.com/maps?' + new URLSearchParams({v:'2.0', key, callback});
      document.head.append(script);
    });
  }
  async function connectMap() {
    if (connecting || map) return;
    if (!config.mapEnabled) {
      mapStatus.textContent = '真实地图待验证：未配置完整高德凭据，当前为离线位置示意。';
      retryMap.hidden = false;
      return;
    }
    connecting = true;
    retryMap.hidden = true;
    mapStatus.textContent = '正在加载高德交互式地图…';
    try {
      window._AMapSecurityConfig = {serviceHost: new URL(config.serviceHost, location.origin).href};
      await loadSDK(config.jsKey);
      mapElement.hidden = false;
      map = new AMap.Map('map', {viewMode: '2D', zoom: 12, center: [116.411571, 39.908069], resizeEnable: true});
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('底图超时')), 12000);
        map.on('complete', () => {clearTimeout(timer); resolve();});
      });
      preview.hidden = true;
      mapElement.setAttribute('data-ready', 'true');
      showMap();
      mapStatus.textContent = '高德交互式地图 · 可拖动、缩放，点击门店查看探店出处。';
    } catch {
      map?.destroy();
      map = undefined;
      markers = [];
      mapElement.hidden = true;
      mapElement.setAttribute('data-ready', 'false');
      preview.hidden = false;
      fitMap.hidden = true;
      if (current) showSketch(current.origin, current.shops);
      mapStatus.textContent = '高德地图加载失败，请检查网络、凭据及域名白名单后重试地图。当前为位置示意。';
      retryMap.hidden = false;
    } finally {connecting = false;}
  }
  async function configure() {
    try {
      const response = await fetch('/api/amap/config', {signal: AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('配置不可用');
      config = await response.json();
      await connectMap();
    } catch {
      mapStatus.textContent = '地图配置加载失败，真实地图待验证；当前为离线位置示意。';
      retryMap.hidden = false;
    }
  }
  byId('search').addEventListener('submit', event => {event.preventDefault(); search();});
  for (const button of document.querySelectorAll('[data-origin]')) {
    button.addEventListener('click', () => {query.value = button.dataset.origin; search();});
  }
  retrySearch.addEventListener('click', () => search());
  retryMap.addEventListener('click', () => configure());
  fitMap.addEventListener('click', () => {infoWindow?.close(); fit();});
  more.addEventListener('click', () => search(lastInput, current?.origin.id, true));
  creator.addEventListener('change', () => search(lastInput, current?.origin.id));
  byId('clear-filter').addEventListener('click', () => {creator.value = ''; search(lastInput, current?.origin.id);});
  query.value = '王府井';
  mapStatus.textContent = '真实地图待验证：当前为离线固定样本与位置示意。';
  search();
  if (typeof fetch === 'function' && ['http:', 'https:'].includes(location.protocol)) configure();
})();
