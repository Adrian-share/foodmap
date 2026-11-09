(() => {
  'use strict';
  const {restaurants, normalize, resolveFixture, closest} = samples;
  const byId = id => document.getElementById(id);
  const query = byId('query');
  const status = byId('status');
  const list = byId('results');
  const candidates = byId('candidates');
  const preview = byId('preview');
  const mapElement = byId('map');
  let map;
  let amapEnabled = false;
  let searchVersion = 0;

  function point(location) {
    return new BMap.Point(location.lng, location.lat);
  }

  function link(label, url) {
    const anchor = document.createElement('a');
    anchor.textContent = label;
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
  }

  function showList(shops) {
    for (const shop of shops) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      const address = document.createElement('p');
      title.textContent = shop.name + ' · ' + (shop.meters / 1000).toFixed(2) + ' km';
      address.textContent = shop.address;
      item.append(title, address, link('探店记录', shop.source));
      if (shop.video) item.append(link('相关 B 站视频', shop.video));
      list.append(item);
    }
  }

  function showSketch(origin, shops) {
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
    svg.setAttribute('aria-label', '起点及最近三家门店的相对位置，数字与列表对应');
    function shape(tag, attrs, label) {
      const element = document.createElementNS(svg.namespaceURI, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      if (label !== undefined) element.textContent = label;
      svg.append(element);
    }
    for (const shop of shops) {
      shape('line', {x1:x(origin), y1:y(origin), x2:x(shop), y2:y(shop), stroke:'#85a598', 'stroke-dasharray':'5 5'});
    }
    points.forEach((item, index) => {
      shape('circle', {cx:x(item), cy:y(item), r:15, fill:index ? '#137664' : '#173d6b', stroke:'#fff', 'stroke-width':2});
      shape('text', {x:x(item), y:y(item)+5, fill:'#fff', 'text-anchor':'middle', 'font-size':13}, index || '起');
    });
    shape('text', {x:20,y:30,fill:'#345753','font-size':14}, '离线位置示意 · 北 ↑');
    preview.append(svg);
  }

  function showBaidu(origin, shops) {
    const points = [origin, ...shops].map(point);
    [origin, ...shops].forEach((item, index) => {
      const marker = new BMap.Marker(points[index]);
      const caption = index ? index + ' · ' + item.name : '起点 · ' + item.name;
      marker.setLabel(new BMap.Label(caption, {offset:new BMap.Size(12, -18)}));
      if (index) marker.addEventListener('click', () => list.children[index - 1].scrollIntoView({block:'nearest'}));
      map.addOverlay(marker);
    });
    map.setViewport(points, {margins:[60, 90, 60, 70]});
  }

  function render(origin) {
    list.replaceChildren();
    preview.replaceChildren();
    const distance = map ? (a, b) => map.getDistance(point(a), point(b)) : undefined;
    const shops = closest(origin, restaurants, distance);
    showList(shops);
    if (map) showBaidu(origin, shops);
    else showSketch(origin, shops);
    status.textContent = (map ? '百度地点检索 · ' : amapEnabled ? '高德地点检索 · ' : '离线样本 · ')
      + origin.name + ' · 十家样本中直线距离最近的三家';
  }

  function selectAmap(origin, version) {
    if (version !== searchVersion) return;
    candidates.replaceChildren();
    render(origin);
    const image = document.createElement('img');
    image.className = 'amap-image';
    image.alt = '高德底图。S 为起点，1 至 3 为按距离排序的门店。';
    image.onload = () => {
      if (version === searchVersion) preview.replaceChildren(image);
    };
    image.onerror = () => {
      if (version === searchVersion) status.textContent += ' · 底图加载失败，当前为位置示意。';
    };
    image.src = '/api/amap/map?' + new URLSearchParams({lng:origin.lng, lat:origin.lat});
  }

  async function searchAmap(name, version) {
    status.textContent = '正在高德地图搜索地点…';
    try {
      const response = await fetch('/api/amap/search?' + new URLSearchParams({q:name}));
      const result = await response.json();
      if (version !== searchVersion) return;
      if (!response.ok) throw new Error('地点检索失败');
      const {matches} = result;
      if (matches.length === 1) {
        selectAmap(matches[0], version);
        return;
      }
      status.textContent = matches.length ? '请选择准确的起点。' : '未找到可定位的地点。';
      matches.slice(0, 6).forEach(poi => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = poi.name + (poi.address ? ' · ' + poi.address : '');
        button.addEventListener('click', () => selectAmap(poi, version));
        candidates.append(button);
      });
    } catch {
      if (version === searchVersion) status.textContent = '高德地点检索失败，请稍后再试。';
    }
  }

  function search() {
    const version = ++searchVersion;
    const name = normalize(query.value);
    list.replaceChildren();
    preview.replaceChildren();
    candidates.replaceChildren();
    map?.clearOverlays();
    if (!name) {
      status.textContent = '请输入地点名称。';
      return;
    }
    if (!map && amapEnabled) {
      searchAmap(name, version);
      return;
    }
    if (!map) {
      const origin = resolveFixture(name);
      if (origin) render(origin);
      else status.textContent = '离线样本支持王府井、东坝和大钟寺。';
      return;
    }
    const station = resolveFixture(name);
    status.textContent = '正在百度地图搜索地点…';
    const timeout = setTimeout(() => {
      if (version === searchVersion) status.textContent = '百度地点搜索超时，请核对网络和密钥。';
    }, 12000);
    const local = new BMap.LocalSearch('北京市', {
      onSearchComplete(result) {
        clearTimeout(timeout);
        if (version !== searchVersion) return;
        if (local.getStatus() !== BMAP_STATUS_SUCCESS || !result) {
          status.textContent = '百度地点搜索未返回结果，请核对地名、网络和密钥权限。';
          return;
        }
        const matches = [];
        for (let i = 0; i < result.getCurrentNumPois(); i++) {
          const poi = result.getPoi(i);
          if (poi?.point) matches.push(poi);
        }
        function select(poi) {
          candidates.replaceChildren();
          map.clearOverlays();
          render({name:poi.title, lng:poi.point.lng, lat:poi.point.lat});
        }
        const exactStation = station && matches.find(poi =>
          poi.title.replace(/[()（）]/g, '') === station.name);
        if (exactStation || (!station && matches.length === 1)) {
          select(exactStation || matches[0]);
          return;
        }
        status.textContent = matches.length ? '请选择准确的起点。' : '未找到可定位的地点。';
        matches.slice(0, 6).forEach(poi => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = poi.title + (poi.address ? ' · ' + poi.address : '');
          button.addEventListener('click', () => select(poi));
          candidates.append(button);
        });
      }
    });
    local.search(station ? station.name : name);
  }

  byId('search').addEventListener('submit', event => {event.preventDefault(); search();});
  for (const button of document.querySelectorAll('[data-origin]')) {
    button.addEventListener('click', () => {query.value = button.dataset.origin; search();});
  }

  byId('connect').addEventListener('submit', event => {
    event.preventDefault();
    const input = byId('ak');
    const key = input.value.trim();
    if (!key || map) return;
    const submit = event.submitter;
    submit.disabled = true;
    status.textContent = '正在连接百度地图…';
    const script = document.createElement('script');
    const callback = 'initializeBaiduMap' + Date.now();
    const timer = setTimeout(fail, 12000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      window[callback] = () => {};
      map = undefined;
      mapElement.hidden = true;
      preview.hidden = false;
      submit.disabled = false;
      status.textContent = '百度地图连接失败。请检查浏览器端密钥、来源白名单和网络。';
    }
    window[callback] = () => {
      clearTimeout(timer);
      delete window[callback];
      try {
        BMap.coordType = BMAP_COORD_GCJ02;
        mapElement.hidden = false;
        const liveMap = new BMap.Map('map');
        liveMap.centerAndZoom(new BMap.Point(116.411571, 39.908069), 13);
        liveMap.enableScrollWheelZoom(true);
        map = liveMap;
        preview.hidden = true;
        input.value = '';
        search();
      } catch {
        fail();
      }
    };
    script.onerror = fail;
    script.src = 'https://api.map.baidu.com/api?' + new URLSearchParams({v:'4.0',ak:key,callback});
    document.head.append(script);
  });

  query.value = '王府井';
  search();
  if (typeof fetch === 'function' && ['http:', 'https:'].includes(location.protocol)) {
    fetch('/api/amap/status')
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        if (result?.enabled) {
          amapEnabled = true;
          if (!map) search();
        }
      })
      .catch(() => {});
  }
})();
