// Copyright ArtifexNexus. All Rights Reserved.
// Based on soft-ue-cli by softdaddy-o (MIT License)

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Dom/JsonObject.h"
#include "InputInjectionAPI.generated.h"

UCLASS()
class ARTIFEXNEXUSAPI_API UInputInjectionAPI : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Send key input to PIE. Action: "press", "release", "click" */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString TriggerKeyInput(
		const FString& Key,
		const FString& Action = TEXT("click"));

	/** Send mouse button input. Button: "left", "right", "middle" */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString TriggerMouseInput(
		float X, float Y,
		const FString& Button = TEXT("left"),
		const FString& Action = TEXT("click"));

	/** Send axis input (gamepad sticks, etc.) */
	UFUNCTION(BlueprintCallable, Category="ArtifexNexus|PIE")
	static FString TriggerAxisInput(
		const FString& AxisName,
		float Value);

private:
	static UWorld* FindGameWorld();
	static APlayerController* GetPlayerController(UWorld* World, int32 PlayerIndex = 0);
};