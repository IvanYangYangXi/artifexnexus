// Copyright Artifex Nexus Contributors. All Rights Reserved.

#include "ArtifexNexus.h"
#include "ArtifexNexusPanel.h"
#include "ToolMenus.h"
#include "LevelEditor.h"
#include "Widgets/Docking/SDockTab.h"
#include "Framework/Docking/TabManager.h"

#define LOCTEXT_NAMESPACE "FArtifexNexusModule"

static const FName ArtifexNexusTabName("ArtifexNexusPanel");

void FArtifexNexusModule::StartupModule()
{
	// Register tab spawner for control panel
	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
		ArtifexNexusTabName,
		FOnSpawnTab::CreateLambda([](const FSpawnTabArgs& Args) -> TSharedRef<SDockTab>
		{
			return SNew(SDockTab)
				.TabRole(ETabRole::NomadTab)
				.Label(LOCTEXT("TabLabel", "Artifex Nexus"))
				[
					SNew(SArtifexNexusPanel)
				];
		}))
		.SetDisplayName(LOCTEXT("TabDisplayName", "Artifex Nexus"))
		.SetMenuType(ETabSpawnerMenuType::Enabled);

	// Register Window menu entry + toolbar button
	RegisterMenus();
}

void FArtifexNexusModule::ShutdownModule()
{
	FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(ArtifexNexusTabName);
}

void FArtifexNexusModule::RegisterMenus()
{
	// Add to Window menu
	FToolMenuOwnerScoped OwnerScoped(this);

	UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Window");
	FToolMenuSection& Section = Menu->FindOrAddSection("WindowLayout");
	Section.AddMenuEntry(
		"ArtifexNexusPanel",
		LOCTEXT("MenuLabel", "Artifex Nexus"),
		LOCTEXT("MenuTooltip", "Open the Artifex Nexus control panel"),
		FSlateIcon(),
		FUIAction(FExecuteAction::CreateLambda([]()
		{
			FGlobalTabmanager::Get()->TryInvokeTab(ArtifexNexusTabName);
		}))
	);
}

void FArtifexNexusModule::PluginButtonClicked()
{
	FGlobalTabmanager::Get()->TryInvokeTab(ArtifexNexusTabName);
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FArtifexNexusModule, ArtifexNexus)
