// Copyright ArtifexNexus. All Rights Reserved.
// Based on soft-ue-cli by softdaddy-o (MIT License)

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Dom/JsonObject.h"
#include "PIEControlAPI.generated.h"

UCLASS()
class ARTIFEXNEXUSAPI_API UPIEControlAPI : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Start PIE session. Mode: "viewport", "new_window", "standalone" */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEStart(
		const FString& Mode = TEXT("viewport"),
		const FString& MapPath = TEXT(""),
		float Timeout = 30.0f);

	/** Stop PIE session */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEStop();

	/** Pause PIE */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEPause();

	/** Resume PIE */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEResume();

	/** Get PIE state: world info, players, paused status */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEGetState(const FString& Include = TEXT("all"));

	/** Wait for a condition on a PIE actor property */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString PIEWaitFor(
		const FString& ActorName,
		const FString& PropertyName,
		const FString& Operator = TEXT("equals"),
		const FString& ExpectedValue = TEXT(""),
		float Timeout = 10.0f,
		float PollInterval = 0.1f);

private:
	static UWorld* GetPIEWorld();
	static bool WaitForPIEReady(float TimeoutSeconds);
	static TSharedPtr<FJsonObject> GetWorldInfo(UWorld* PIEWorld);
	static TArray<TSharedPtr<FJsonValue>> GetPlayersInfo(UWorld* PIEWorld);
	static AActor* FindActorByName(UWorld* World, const FString& ActorName);
	static TSharedPtr<FJsonValue> GetActorProperty(AActor* Actor, const FString& PropertyName);
};