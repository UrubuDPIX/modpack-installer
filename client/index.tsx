/* eslint-disable */
import React from "react";
import { Route, Switch } from "react-router-dom";
import ModpacksPage from "./pages/ModpacksPage";
import ModpackDetailsPage from "./pages/ModpackDetailsPage";
import ModpackSettingsPage from "./pages/ModpackSettingsPage";
import "./styles.css";

export default function ModpackInstallerAddon() {
  return (
    <Switch>
      <Route path="/modpacks" component={ModpacksPage} exact />
      <Route path="/modpacks/:slug" component={ModpackDetailsPage} exact />
      <Route
        path="/admin/modpack-settings"
        component={ModpackSettingsPage}
        exact
      />
    </Switch>
  );
}
