import React from 'react';
import { Route, Routes } from 'react-router-dom';
import ModpacksPage from './pages/ModpacksPage';
import './styles.css';

export default function ModpackInstallerAddon() {
  return (
    <Routes>
      <Route path="/modpacks" element={<ModpacksPage />} />
    </Routes>
  );
}
