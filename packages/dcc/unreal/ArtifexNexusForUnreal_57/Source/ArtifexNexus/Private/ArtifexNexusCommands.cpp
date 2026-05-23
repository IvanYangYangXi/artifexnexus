// Copyright Artifex Nexus Contributors. All Rights Reserved.

#include "ArtifexNexusCommands.h"

#define LOCTEXT_NAMESPACE "FArtifexNexusModule"

void FArtifexNexusCommands::RegisterCommands()
{
	UI_COMMAND(PluginAction, "Artifex Nexus", "Open Artifex Nexus AI control panel", EUserInterfaceActionType::Button, FInputChord());
}

#undef LOCTEXT_NAMESPACE
