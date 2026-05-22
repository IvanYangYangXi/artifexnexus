// Copyright ArtifexNexus. All Rights Reserved.
// Based on soft-ue-cli by softdaddy-o (MIT License)

#pragma once

#include "CoreMinimal.h"
#include "Engine/Engine.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Dom/JsonObject.h"
#include "BuildSystemAPI.generated.h"

/**
 * Build System API for triggering C++ compilation and Live Coding
 * Based on soft-ue-cli build tools implementation
 */
UCLASS()
class ARTIFEXNEXUSAPI_API UBuildSystemAPI : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /** Trigger full C++ rebuild, optionally wait and return result */
    UFUNCTION(BlueprintCallable, Category="ArtifexNexus|Build")
    static FString BuildAndRelaunch(bool bWait = true);

    /** Trigger Live Coding hot reload */
    UFUNCTION(BlueprintCallable, Category="ArtifexNexus|Build")
    static FString TriggerLiveCoding();

private:
    // Helper functions for JSON generation
    static FString JsonToString(const TSharedPtr<FJsonObject>& JsonObject);
    static FString ArtifexNexusMakeError(const FString& ErrorMessage);
    static FString ArtifexNexusMakeSuccess(const FString& Status, const FString& Message);
};