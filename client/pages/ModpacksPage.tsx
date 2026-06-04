import React from "react";
import { useParams } from "react-router-dom";
import ModpacksContainer from "../components/ModpacksContainer";

export default function ModpacksPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="modpack-page">
      <ModpacksContainer serverId={id!} />
    </div>
  );
}
