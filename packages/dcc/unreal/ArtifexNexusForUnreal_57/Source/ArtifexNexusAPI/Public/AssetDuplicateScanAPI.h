// Copyright ArtifexNexus. All Rights Reserved.
// Asset Duplicate/Similarity Scan API — detect redundant meshes and textures

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AssetDuplicateScanAPI.generated.h"

/**
 * Single asset entry in a duplicate group.
 */
USTRUCT(BlueprintType)
struct ARTIFEXNEXUSAPI_API FDuplicateAssetInfo
{
    GENERATED_BODY()

    /** Full asset package path (e.g., /Game/Meshes/SM_Chair) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    FString AssetPath;

    /** Short display name */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    FString AssetName;

    /** Package disk size in bytes (0 = unknown) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int64 DiskSizeBytes = 0;

    /** Hamming distance to group representative (SimilarTexture mode only) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int32 DistanceToRepresentative = 0;
};

/**
 * A group of assets considered duplicates/similar.
 */
USTRUCT(BlueprintType)
struct ARTIFEXNEXUSAPI_API FDuplicateGroupInfo
{
    GENERATED_BODY()

    /** Group signature (hash key for debugging/export) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    FString GroupSignature;

    /** Group members (at least 2) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    TArray<FDuplicateAssetInfo> Members;

    /** Max hamming distance within group (SimilarTexture only) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int32 MaxHammingDistance = 0;

    /** Estimated redundant bytes (total - largest member) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int64 EstimatedRedundantBytes = 0;
};

/**
 * Overall scan result.
 */
USTRUCT(BlueprintType)
struct ARTIFEXNEXUSAPI_API FDuplicateScanResultInfo
{
    GENERATED_BODY()

    /** Duplicate/similar groups found */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    TArray<FDuplicateGroupInfo> Groups;

    /** Total assets scanned */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int32 TotalScanned = 0;

    /** Assets skipped (load failure, unsupported format, etc.) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int32 SkippedCount = 0;

    /** Total duplicate assets (sum of all group member counts) */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int32 TotalDuplicateAssets = 0;

    /** Estimated total redundant bytes */
    UPROPERTY(BlueprintReadOnly, Category = "DuplicateScan")
    int64 EstimatedRedundantBytes = 0;
};

/**
 * Perceptual hash algorithm for similar texture detection.
 */
UENUM(BlueprintType)
enum class EPerceptualHashAlgorithm : uint8
{
    /** Sobel edge detection + 8x8 average hash */
    SobelAHash = 0  UMETA(DisplayName = "Sobel + aHash"),
    /** 8x9 difference hash (fastest) */
    DiffHash = 1    UMETA(DisplayName = "dHash"),
    /** DCT perceptual hash (most robust) */
    PerceptualHash = 2 UMETA(DisplayName = "pHash (DCT)")
};

/**
 * Asset Duplicate & Similarity Scan API.
 *
 * Algorithms:
 * - Duplicate Mesh: FNV-1a hash on LOD0 GPU buffers (position/index/UV/normal) + material + bounds
 * - Identical Texture: MD5 hash on top MIP raw data
 * - Similar Texture: 64-bit perceptual hash + Union-Find clustering by Hamming distance
 *
 * All functions are Blueprint-callable and exposed to Python via UE reflection.
 */
UCLASS()
class ARTIFEXNEXUSAPI_API UAssetDuplicateScanAPI : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    /**
     * Scan for duplicate StaticMesh assets within a content directory.
     * Uses FNV-1a hash on LOD0 geometry buffers — 100% precision.
     *
     * @param SearchPath Content directory to scan (e.g., "/Game/Meshes"). Empty = entire /Game.
     * @param bRecursive Recurse into subdirectories (default true)
     * @return Scan result with groups of duplicate meshes
     */
    UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|DuplicateScan", CallInEditor)
    static FDuplicateScanResultInfo ScanDuplicateMeshes(
        const FString& SearchPath = TEXT("/Game"),
        bool bRecursive = true);

    /**
     * Scan for byte-identical textures within a content directory.
     * Uses MD5 on top MIP data — 100% precision.
     *
     * @param SearchPath Content directory to scan (e.g., "/Game/Textures"). Empty = entire /Game.
     * @param bRecursive Recurse into subdirectories (default true)
     * @param bRespectTypeSuffix Only group textures with same type suffix (_D, _N, etc.) (default true)
     * @return Scan result with groups of identical textures
     */
    UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|DuplicateScan", CallInEditor)
    static FDuplicateScanResultInfo ScanIdenticalTextures(
        const FString& SearchPath = TEXT("/Game"),
        bool bRecursive = true,
        bool bRespectTypeSuffix = true);

    /**
     * Scan for visually similar textures within a content directory.
     * Uses perceptual hashing + Union-Find clustering — configurable precision via threshold.
     *
     * @param SearchPath Content directory to scan. Empty = entire /Game.
     * @param bRecursive Recurse into subdirectories (default true)
     * @param Algorithm Perceptual hash algorithm to use (default: pHash DCT)
     * @param HammingThreshold Max hamming distance to consider similar (0-64, lower = stricter, default 8)
     * @param bRespectTypeSuffix Only group textures with same type suffix (default true)
     * @return Scan result with groups of similar textures
     */
    UFUNCTION(BlueprintCallable, Category = "ArtifexNexus|DuplicateScan", CallInEditor)
    static FDuplicateScanResultInfo ScanSimilarTextures(
        const FString& SearchPath = TEXT("/Game"),
        bool bRecursive = true,
        EPerceptualHashAlgorithm Algorithm = EPerceptualHashAlgorithm::PerceptualHash,
        int32 HammingThreshold = 8,
        bool bRespectTypeSuffix = true);
};
