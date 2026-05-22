// Copyright ArtifexNexus. All Rights Reserved.
// Ref: docs/UEArtifexNexus/features/xatlas-integration/design.md#4
// xatlas BP/Python API - Blueprint function library

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "XAtlasTypes.h"
#include "ArtifexNexusXAtlasAPI.generated.h"

/**
 * Blueprint/Python API for xatlas UV repack operations.
 */
UCLASS()
class ARTIFEXNEXUSAPI_API UArtifexNexusXAtlasAPI : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	// --- Repack ---

	/** Repack UVs of a single static mesh. */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static FXAtlasBatchRepackResult RepackUVs(
		UStaticMesh* Mesh,
		int32 SrcUV = 0,
		int32 DstUV = 1,
		FXAtlasRepackOptions Options = FXAtlasRepackOptions());

	/** Batch repack UVs of multiple meshes (supports cross-mesh overlap detection). */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static FXAtlasBatchRepackResult BatchRepackUVs(
		const TArray<FXAtlasMeshEntry>& Meshes,
		FXAtlasRepackOptions Options = FXAtlasRepackOptions());

	// --- Texture Adaptation ---

	/** Adapt source texture(s) to the new UV layout. Returns the new texture. */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static UTexture2D* AdaptTexture(
		const FXAtlasBatchRepackResult& RepackResult,
		FXAtlasTextureAdaptOptions Options);

	/** Adapt source texture(s) to the new UV layout and save to file. */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static bool AdaptTextureToFile(
		const FXAtlasBatchRepackResult& RepackResult,
		FXAtlasTextureAdaptOptions Options,
		const FString& OutputPath);

	// --- Utilities ---

	/** Copy UV channel from Src to Dst on a static mesh. */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static bool CopyUVChannel(
		UStaticMesh* Mesh,
		int32 SrcChannel,
		int32 DstChannel,
		int32 LODIndex = 0);

	/** Detect overlap groups without performing repack. */
	UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|XAtlas")
	static TArray<FXAtlasOverlapGroup> DetectOverlapGroups(
		const TArray<FXAtlasMeshEntry>& Meshes);
};
