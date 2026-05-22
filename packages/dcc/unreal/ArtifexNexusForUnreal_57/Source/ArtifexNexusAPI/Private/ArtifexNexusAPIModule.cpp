// Copyright ArtifexNexus. All Rights Reserved.

#include "ArtifexNexusAPI.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY(LogArtifexNexusAPI);

#define LOCTEXT_NAMESPACE "FArtifexNexusAPIModule"

void FArtifexNexusAPIModule::StartupModule()
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("ArtifexNexusAPI module started"));
}

void FArtifexNexusAPIModule::ShutdownModule()
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("ArtifexNexusAPI module shutdown"));
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FArtifexNexusAPIModule, ArtifexNexusAPI)