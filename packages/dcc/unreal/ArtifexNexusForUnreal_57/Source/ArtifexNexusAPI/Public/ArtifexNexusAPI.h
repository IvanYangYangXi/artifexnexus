// Copyright ArtifexNexus. All Rights Reserved.
// Ref: docs/ArtifexNexus/features/UE全能力API开发清单.md

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

DECLARE_LOG_CATEGORY_EXTERN(LogArtifexNexusAPI, Log, All);

class FArtifexNexusAPIModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;
};