// Copyright Artifex Nexus Contributors. All Rights Reserved.

#include "ArtifexNexus.h"
#include "ArtifexNexusStyle.h"
#include "ArtifexNexusCommands.h"
#include "ArtifexNexusPanel.h"
#include "ToolMenus.h"
#include "Widgets/Docking/SDockTab.h"
#include "Framework/Docking/TabManager.h"

static const FName ArtifexNexusTabName("ArtifexNexusPanel");

const FName FArtifexNexusModule::DashboardTabName("ArtifexNexusDashboard");

#define LOCTEXT_NAMESPACE "FArtifexNexusModule"

void FArtifexNexusModule::StartupModule()
{
	// Initialize style (icons, brushes)
	FArtifexNexusStyle::Initialize();
	FArtifexNexusStyle::ReloadTextures();

	// Register commands (toolbar button label, icon, etc.)
	FArtifexNexusCommands::Register();

	PluginCommands = MakeShareable(new FUICommandList);
	PluginCommands->MapAction(
		FArtifexNexusCommands::Get().PluginAction,
		FExecuteAction::CreateRaw(this, &FArtifexNexusModule::PluginButtonClicked),
		FCanExecuteAction());

	// Defer menu + toolbar registration until UToolMenus is ready
	UToolMenus::RegisterStartupCallback(
		FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FArtifexNexusModule::RegisterMenus));

	// Register dockable dashboard tab
	RegisterDashboardTab();
}

void FArtifexNexusModule::ShutdownModule()
{
	UToolMenus::UnRegisterStartupCallback(this);
	UToolMenus::UnregisterOwner(this);

	FArtifexNexusStyle::Shutdown();
	FArtifexNexusCommands::Unregister();

	FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(DashboardTabName);
}

void FArtifexNexusModule::PluginButtonClicked()
{
	FGlobalTabmanager::Get()->TryInvokeTab(DashboardTabName);
}

void FArtifexNexusModule::RegisterMenus()
{
	FToolMenuOwnerScoped OwnerScoped(this);

	// Window menu entry
	{
		UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Window");
		FToolMenuSection& Section = Menu->FindOrAddSection("WindowLayout");
		Section.AddMenuEntryWithCommandList(FArtifexNexusCommands::Get().PluginAction, PluginCommands);
	}

	// Toolbar button (in PlayToolBar extension area, same as artclaw)
	{
		UToolMenu* ToolbarMenu = UToolMenus::Get()->ExtendMenu("LevelEditor.LevelEditorToolBar.PlayToolBar");
		FToolMenuSection& Section = ToolbarMenu->FindOrAddSection("PluginTools");
		FToolMenuEntry& Entry = Section.AddEntry(FToolMenuEntry::InitToolBarButton(FArtifexNexusCommands::Get().PluginAction));
		Entry.SetCommandList(PluginCommands);
	}
}

void FArtifexNexusModule::RegisterDashboardTab()
{
	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
		DashboardTabName,
		FOnSpawnTab::CreateRaw(this, &FArtifexNexusModule::SpawnDashboardTab))
		.SetDisplayName(LOCTEXT("DashboardTabTitle", "Artifex Nexus"))
		.SetMenuType(ETabSpawnerMenuType::Hidden)  // Manual menu entry only
		.SetIcon(FSlateIcon(FArtifexNexusStyle::GetStyleSetName(), "ArtifexNexus.TabIcon"));
}

TSharedRef<SDockTab> FArtifexNexusModule::SpawnDashboardTab(const FSpawnTabArgs& Args)
{
	return SNew(SDockTab)
		.TabRole(ETabRole::NomadTab)
		[
			SNew(SArtifexNexusPanel)
		];
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FArtifexNexusModule, ArtifexNexus)
