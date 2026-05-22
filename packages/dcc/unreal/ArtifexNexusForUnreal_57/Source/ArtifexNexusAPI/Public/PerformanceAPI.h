// Copyright ArtifexNexus. All Rights Reserved.
// Based on soft-ue-cli by softdaddy-o (MIT License)

#pragma once

#include "CoreMinimal.h"
#include "Engine/Engine.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Dom/JsonObject.h"
#include "PerformanceAPI.generated.h"

/**
 * Performance API for Unreal Insights trace capture and analysis
 * Based on soft-ue-cli performance tools implementation
 */
UCLASS()
class ARTIFEXNEXUSAPI_API UPerformanceAPI : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /** Start or stop Insights trace capture */
    UFUNCTION(BlueprintCallable, Category="ArtifexNexus|Performance")
    static FString InsightsCapture(
        const FString& Action,  // "start" or "stop"
        const FString& Channels = TEXT("default,cpu,gpu,frame"));

    /** List available trace files */
    UFUNCTION(BlueprintCallable, Category="ArtifexNexus|Performance")
    static FString InsightsListTraces();

    /** Analyze trace file for hotspots */
    UFUNCTION(BlueprintCallable, Category="ArtifexNexus|Performance")
    static FString InsightsAnalyze(
        const FString& TraceFile = TEXT("latest"),
        const FString& AnalysisType = TEXT("cpu"));

private:
    // Helper functions for JSON generation
    static FString JsonToString(const TSharedPtr<FJsonObject>& JsonObject);
    static FString ArtifexNexusMakeError(const FString& ErrorMessage);
    static FString StartCapture(const FString& Channels);
    static FString StopCapture();
    static FString GetCaptureStatus();
    static FString AnalyzeBasicInfo(const FString& TraceFile);
};