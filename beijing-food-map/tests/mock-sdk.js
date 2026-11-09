// 仅用于浏览器契约测试，不代表真实高德底图或鉴权通过。
(() => {
  class Map {
    constructor(id) {
      this.container = document.getElementById(id);
      this.container.dataset.sdkMock = 'true';
      this.container.append(Object.assign(document.createElement('p'), {
        textContent: '固定响应测试 · 模拟 SDK · 非真实高德底图', className: 'mock-watermark'
      }));
      this.markers = [];
      window.sdkMap = this;
    }
    add(markers) {
      for (const marker of [].concat(markers)) {
        this.markers.push(marker);
        marker.map = this;
        this.container.append(marker.content);
        marker.content.addEventListener('click', () => marker.listeners.click?.());
      }
    }
    remove(markers) {
      for (const marker of markers) marker.content.remove();
      this.markers = this.markers.filter(item => !markers.includes(item));
    }
    setFitView(markers, immediate, padding) {
      this.fitted = markers.map(marker => marker.position);
      this.padding = padding;
      const xs = markers.map(item => item.position[0]);
      const ys = markers.map(item => item.position[1]);
      markers.forEach(marker => Object.assign(marker.content.style, {
        position: 'absolute',
        left: (15 + 65 * (marker.position[0] - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1)) + '%',
        top: (75 - 55 * (marker.position[1] - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1)) + '%'
      }));
    }
    on(event, handler) { if (event === 'complete') setTimeout(handler, 0); }
    addControl() {}
    destroy() { this.container.replaceChildren(); }
  }
  class Marker {
    constructor(options) { Object.assign(this, options); this.listeners = {}; }
    on(event, handler) { this.listeners[event] = handler; }
    getPosition() { return this.position; }
  }
  class InfoWindow {
    constructor(options) { Object.assign(this, options); }
    open(map) { this.close(); this.map = map; map.container.append(this.content); }
    close() { this.content.remove(); }
  }
  window.AMap = {Map, Marker, InfoWindow, Pixel: class {}, Scale: class {}};
  const callback = new URL(document.currentScript.src).searchParams.get('callback');
  window[callback]();
})();
