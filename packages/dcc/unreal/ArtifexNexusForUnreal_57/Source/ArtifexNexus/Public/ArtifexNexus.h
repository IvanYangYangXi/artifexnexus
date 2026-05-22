// Copyright Artifex Nexus Contributors. All Rights Reserved.

#pragma once

#include "Modules/ModuleManager.h"

/**
 * FArtifexNexusModule
 * Artifex Nexus for Unreal — MCP bridge plugin module entry.
 *
 * Provides toolbar/Window menu entry to open the control panel.
 * All Chat/Agent/Skill/Tool management is handled via the Web UI.
 */
class FArtifexNexusModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	/** Register toolbar button and Window menu entry */
	void RegisterMenus();

	/** Toolbar button clicked → open control panel */
	void PluginButtonClicked();
};
