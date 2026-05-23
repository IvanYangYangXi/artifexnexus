// Copyright Artifex Nexus Contributors. All Rights Reserved.

#pragma once

#include "Framework/Commands/Commands.h"
#include "ArtifexNexusStyle.h"

class FArtifexNexusCommands : public TCommands<FArtifexNexusCommands>
{
public:
	FArtifexNexusCommands()
		: TCommands<FArtifexNexusCommands>(
			TEXT("ArtifexNexus"),
			NSLOCTEXT("Contexts", "ArtifexNexus", "Artifex Nexus Plugin"),
			NAME_None,
			FArtifexNexusStyle::GetStyleSetName())
	{
	}

	virtual void RegisterCommands() override;

public:
	TSharedPtr<FUICommandInfo> PluginAction;
};
