// Copyright Artifex Nexus Contributors. All Rights Reserved.

#pragma once

#include "Modules/ModuleManager.h"
#include "Styling/SlateStyle.h"

class FArtifexNexusModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	void RegisterDashboardTab();
	void RegisterMenus();
	void PluginButtonClicked();

	TSharedRef<SDockTab> SpawnDashboardTab(const FSpawnTabArgs& Args);

	TSharedPtr<FUICommandList> PluginCommands;

	static const FName DashboardTabName;
};
