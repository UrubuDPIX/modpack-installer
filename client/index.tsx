import React from 'react';
import { Route, Routes } from 'react-router-dom';
import ModpacksPage from './pages/ModpacksPage';
import ModpackSettingsPage from './pages/ModpackSettingsPage';
import './styles.css';

export default function ModpackInstallerAddon() {
  return (
    <Routes>
      <Route path="/modpacks" element={<ModpacksPage />} />
      <Route path="/admin/modpack-settings" element={<ModpackSettingsPage />} />
    </Routes>
  );
}
