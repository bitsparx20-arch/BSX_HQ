import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "@/lib/api";
import ModuleTable from "@/components/ModuleTable";
import { PageHeader, Section, formatDate } from "@/components/Shared";

// Fix default marker icon path with vector replacement
const icon = new L.DivIcon({
  className: "",
  html: `<div style="width:28px;height:28px;background:#2453E5;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 8px rgba(36,83,229,0.4);"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function FitToBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
  }, [points, map]);
  return null;
}

export default function ClientVisits() {
  const [visits, setVisits] = useState([]);
  useEffect(() => { api.get("/visits").then(({ data }) => setVisits(data)); }, []);

  const points = visits.filter((v) => v.lat && v.lng);

  return (
    <div>
      <PageHeader
        eyebrow="Module · 06"
        title="Client Visits & Location"
        description="Pin drops, visit logs, geo-tracking and meeting outcomes — visualised on a live map."
      />

      <Section title={`Visit Map · ${points.length} pins`} className="mb-6">
        <div className="p-3">
          <div className="rounded-lg overflow-hidden border border-slate-200" style={{ height: 380 }}>
            <MapContainer
              center={[22.0, 80.0]}
              zoom={5}
              scrollWheelZoom={true}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                subdomains='abcd'
                maxZoom={20}
              />
              {points.map((v) => (
                <Marker key={v.id} position={[v.lat, v.lng]} icon={icon}>
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold text-slate-900 mb-1">{v.client}</div>
                      <div className="text-slate-600">{v.location}</div>
                      <div className="text-xs text-slate-500 mt-1.5">
                        <span className="font-semibold">{v.employee}</span> · {formatDate(v.visit_date)}
                      </div>
                      {v.outcome && <div className="text-xs text-slate-700 mt-1.5 pt-1.5 border-t border-slate-200">{v.outcome}</div>}
                    </div>
                  </Popup>
                </Marker>
              ))}
              <FitToBounds points={points} />
            </MapContainer>
          </div>
        </div>
      </Section>

      <ModuleTable
        endpoint="/visits" title="Visit Log" testId="visits"
        columns={[
          { key: "client", label: "Client", type: "bold" },
          { key: "location", label: "Location" },
          { key: "visit_date", label: "Date", type: "date" },
          { key: "employee", label: "By" },
          { key: "purpose", label: "Purpose" },
          { key: "outcome", label: "Outcome" },
          { key: "lat", label: "Coords", render: (r) => r.lat ? <span className="bx-mono text-xs">{r.lat?.toFixed?.(3)}, {r.lng?.toFixed?.(3)}</span> : "—" },
        ]}
        fields={[
          { key: "client", label: "Client", required: true },
          { key: "location", label: "Address / Location", full: true },
          { key: "lat", label: "Latitude", type: "number" },
          { key: "lng", label: "Longitude", type: "number" },
          { key: "visit_date", label: "Date", type: "date" },
          { key: "employee", label: "Employee" },
          { key: "purpose", label: "Purpose", full: true },
          { key: "outcome", label: "Outcome", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
