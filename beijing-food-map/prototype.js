(() => {
  'use strict';
  const {restaurants, normalize, resolveFixture, closest} = samples;
  const byId = id => document.getElementById(id);
  const query = byId('query'), status = byId('status'), list = byId('results');
  const candidates = byId('candidates'), preview = byId('preview'), mapElement = byId('map');
  const mapStatus = byId('map-status'), retrySearch = byId('retry-search'), retryMap = byId('retry-map');
  const fitMap = byId('fit-map');
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
    container.append(title, address, link('探店记录', '/content/?bvid=' + (shop.video?.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
    if (shop.video) container.append(link('相关 B 站视频', '/content/?bvid=' + (shop.video.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
  }
  function selectShop(index) {
    if (!current) return;
    Array.from(list.children).forEach((item, i) => {
      item.setAttribute('aria-current', String(i === index));
    });
    list.children[index].scrollIntoView({block: 'nearest', behavior: 'smooth'});
    if (!map) return;
    infoWindow?.close();
    const content = document.createElement('div');
    content.className = 'shop-info';
    details(current.shops[index], content);
    infoWindow = new AMap.InfoWindow({content, offset: new AMap.Pixel(0, -32), autoMove: false});
    infoWindow.open(map, markers[index + 1].getPosition());
  }
  function showList(shops) {
    shops.forEach((shop, index) => {
      const item = document.createElement('li');
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'shop-select';
      title.textContent = shop.name + ' · ' + (shop.meters / 1000).toFixed(2) + ' km';
      title.addEventListener('click', () => selectShop(index));
      const address = document.createElement('p');
      address.textContent = shop.address;
      item.append(title, address, link('探店记录', '/content/?bvid=' + (shop.video?.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
      if (shop.video) item.append(link('相关 B 站视频', '/content/?bvid=' + (shop.video.match(/BV[0-9A-Za-z]{10}/)?.[0] || '')));
      list.append(item);
    });
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
    fit();
    fitMap.hidden = false;
  }
  function render(origin, version) {
    if (version !== searchVersion) return;
    clear();
    const shops = closest(origin, restaurants);
    current = {origin, shops};
    showList(shops);
    if (map) showMap();
    else showSketch(origin, shops);
    status.textContent = (config.searchEnabled ? '高德地点检索 · ' : '离线固定样本 · ')
      + origin.name + (origin.address ? ' · ' + origin.address : '')
      + ' · 十家样本中直线距离最近的三家';
  }
  function validOrigin(item) {
    return item && typeof item.name === 'string' && Number.isFinite(item.lng) && Number.isFinite(item.lat)
      && item.lng >= 115.4 && item.lng <= 117.6 && item.lat >= 39.4 && item.lat <= 41.1;
  }
  async function search(input = query.value) {
    lastInput = input;
    const version = ++searchVersion;
    const name = normalize(input);
    clear();
    if (!name) {status.textContent = '请输入地点名称。'; return;}
    if (!config.searchEnabled) {
      const origin = resolveFixture(name);
      if (origin) render(origin, version);
      else status.textContent = '离线样本仅支持王府井、东坝和大钟寺，当前地点未找到。';
      return;
    }
    status.textContent = '正在高德地图搜索地点…';
    try {
      const response = await fetch('/api/amap/search?' + new URLSearchParams({q: name}), {signal: AbortSignal.timeout(12000)});
      const result = await response.json();
      if (version !== searchVersion) return;
      if (!response.ok || !Array.isArray(result.matches) || !result.matches.every(validOrigin)) throw Error('搜索失败');
      const matches = result.matches;
      if (matches.length === 1) {render(matches[0], version); return;}
      status.textContent = matches.length ? '请选择准确的起点。' : '未找到可定位的地点，请更换关键词。';
      matches.forEach(poi => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = poi.name + (poi.address ? ' · ' + poi.address : '');
        button.addEventListener('click', () => render(poi, version));
        candidates.append(button);
      });
    } catch {
      if (version !== searchVersion) return;
      clear();
      status.textContent = '高德地点检索失败，请重试搜索。';
      retrySearch.hidden = false;
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
      search(lastInput);
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
  query.value = '王府井';
  mapStatus.textContent = '真实地图待验证：当前为离线固定样本与位置示意。';
  search();
  if (typeof fetch === 'function' && ['http:', 'https:'].includes(location.protocol)) configure();
})();
