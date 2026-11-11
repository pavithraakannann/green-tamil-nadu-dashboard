import React, { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import Supercluster from "supercluster";
import "leaflet/dist/leaflet.css";

const TAMIL_NADU_CENTER = [11.1, 78.6];
const TAMIL_NADU_ZOOM = 7;
const compactFormat = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const numberFormat = new Intl.NumberFormat("en-IN");

export const MAP_CATEGORIES = [
  { id: "forest", label: "Forest Department", color: "#237b4c" },
  { id: "gov", label: "Govt departments", color: "#d0812f" },
  { id: "other", label: "NGOs and others", color: "#7a5fa8" },
  { id: "palm", label: "Palm", color: "#3f7fae" },
];
const CATEGORY_COLOR = Object.fromEntries(MAP_CATEGORIES.map((category) => [category.id, category.color]));
const CATEGORY_LABEL = Object.fromEntries(MAP_CATEGORIES.map((category) => [category.id, category.label]));

/** Same grouping as the dashboard: palm, Forest Department, government departments, everyone else. */
export function mapCategory({ source, department, govDepartment }) {
  if (source === "palm") return "palm";
  if (department.toLocaleLowerCase() === "forest department") return "forest";
  if (govDepartment) return "gov";
  return "other";
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Popups are built with textContent so data values can never inject HTML.
function pointPopup(point) {
  const root = element("div", "map-popup");
  root.append(element("strong", "", point.govDepartment || point.department || CATEGORY_LABEL[point.category]));
  const rows = [
    ["District", point.district],
    ["Division", point.division],
    ["Year", point.year],
    ["Seedlings", numberFormat.format(point.seedlings)],
    ["Records", numberFormat.format(point.records)],
    ["Location", `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`],
  ];
  const list = element("dl");
  for (const [label, value] of rows) {
    if (!value) continue;
    list.append(element("dt", "", label), element("dd", "", value));
  }
  root.append(list);
  const link = element("a", "", "Open in Google Maps");
  link.href = `https://www.google.com/maps?q=${point.lat},${point.lon}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  root.append(link);
  return root;
}

function clusterIcon(seedlings, count) {
  const size = Math.round(Math.min(58, 30 + Math.log10(Math.max(count, 1)) * 8));
  return L.divIcon({
    html: `<div><span>${compactFormat.format(seedlings)}</span></div>`,
    className: "map-cluster",
    iconSize: [size, size],
  });
}

/**
 * Clustered map of planting points. `points` are already filtered; each has
 * { lat, lon, seedlings, records, category, district, division, year, department, govDepartment }.
 */
export function PlantingMap({ points, height = 520 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const index = useMemo(() => {
    const cluster = new Supercluster({
      radius: 60,
      maxZoom: 16,
      map: (properties) => ({ seedlings: properties.point.seedlings }),
      reduce: (accumulated, properties) => { accumulated.seedlings += properties.seedlings; },
    });
    cluster.load(points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      properties: { point },
    })));
    return cluster;
  }, [points]);

  useEffect(() => {
    const map = L.map(containerRef.current, { preferCanvas: true, minZoom: 5, maxZoom: 19, worldCopyJump: false })
      .setView(TAMIL_NADU_CENTER, TAMIL_NADU_ZOOM);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return undefined;

    function render() {
      layer.clearLayers();
      const bounds = map.getBounds();
      const zoom = Math.round(map.getZoom());
      const features = index.getClusters([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom);
      for (const feature of features) {
        const [lon, lat] = feature.geometry.coordinates;
        if (feature.properties.cluster) {
          const marker = L.marker([lat, lon], {
            icon: clusterIcon(feature.properties.seedlings, feature.properties.point_count),
            title: `${numberFormat.format(feature.properties.point_count)} locations · ${numberFormat.format(feature.properties.seedlings)} seedlings`,
          });
          marker.on("click", () => {
            map.flyTo([lat, lon], Math.min(index.getClusterExpansionZoom(feature.properties.cluster_id), 18));
          });
          layer.addLayer(marker);
        } else {
          const { point } = feature.properties;
          layer.addLayer(L.circleMarker([lat, lon], {
            radius: 7,
            weight: 1.5,
            color: "#fff",
            fillColor: CATEGORY_COLOR[point.category],
            fillOpacity: 0.9,
          }).bindPopup(() => pointPopup(point)));
        }
      }
    }

    render();
    map.on("moveend", render);
    return () => map.off("moveend", render);
  }, [index]);

  // Zoom to the filtered points whenever the selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!points.length) {
      map.setView(TAMIL_NADU_CENTER, TAMIL_NADU_ZOOM);
      return;
    }
    let south = Infinity; let north = -Infinity; let west = Infinity; let east = -Infinity;
    for (const point of points) {
      if (point.lat < south) south = point.lat;
      if (point.lat > north) north = point.lat;
      if (point.lon < west) west = point.lon;
      if (point.lon > east) east = point.lon;
    }
    map.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 14 });
  }, [points]);

  return <div className="planting-map" ref={containerRef} style={{ height }} />;
}

export function MapLegend({ categories = MAP_CATEGORIES }) {
  return (
    <div className="map-legend">
      {categories.map((category) => (
        <span key={category.id}><i style={{ backgroundColor: category.color }} />{category.label}</span>
      ))}
      <span><i className="map-legend-cluster" />Cluster · total seedlings (click to zoom)</span>
    </div>
  );
}
