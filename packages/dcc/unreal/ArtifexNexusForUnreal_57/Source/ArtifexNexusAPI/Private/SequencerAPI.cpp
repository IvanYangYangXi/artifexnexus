// Copyright ArtifexNexus. All Rights Reserved.

#include "SequencerAPI.h"
#include "ArtifexNexusAPI.h"
#include "Utils/JsonHelpers.h"

#include "Engine/World.h"
#include "Engine/Engine.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/SavePackage.h"
#include "Misc/PackageName.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

// Sequencer includes
#include "LevelSequence.h"
#include "MovieScene.h"
#include "MovieSceneTrack.h"
#include "MovieSceneSection.h"
#include "Tracks/MovieSceneTransformTrack.h"
#include "Tracks/MovieSceneAudioTrack.h"
#include "Tracks/MovieSceneEventTrack.h"
#include "Tracks/MovieSceneFloatTrack.h"
#include "Tracks/MovieSceneBoolTrack.h"
#include "Tracks/MovieSceneSkeletalAnimationTrack.h"
#include "Sections/MovieScene3DTransformSection.h"
#include "Sections/MovieSceneFloatSection.h"
#include "Sections/MovieSceneBoolSection.h"
#include "MovieSceneBinding.h"

namespace
{
    ULevelSequence* LoadOrCreateSequence(const FString& AssetPath, bool bCreateIfNotExists = false)
    {
        FString PackageName = AssetPath;
        if (!FPackageName::IsValidLongPackageName(PackageName))
        {
            PackageName = FString::Printf(TEXT("/Game/%s"), *AssetPath);
        }

        ULevelSequence* Sequence = Cast<ULevelSequence>(StaticLoadObject(ULevelSequence::StaticClass(), nullptr, *PackageName));
        
        if (!Sequence && bCreateIfNotExists)
        {
            UPackage* Package = CreatePackage(*PackageName);
            if (!Package)
            {
                return nullptr;
            }

            Sequence = NewObject<ULevelSequence>(Package, *FPackageName::GetLongPackageAssetName(PackageName), RF_Public | RF_Standalone);
            if (Sequence)
            {
                Sequence->Initialize();
                FAssetRegistryModule::AssetCreated(Sequence);
                Sequence->MarkPackageDirty();
            }
        }

        return Sequence;
    }
}

FString USequencerAPI::CreateLevelSequence(const FString& AssetPath)
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("CreateLevelSequence: %s"), *AssetPath);

    if (AssetPath.IsEmpty())
    {
        return ArtifexNexusJson::MakeError(TEXT("AssetPath cannot be empty"));
    }

    ULevelSequence* Sequence = LoadOrCreateSequence(AssetPath, true);
    if (!Sequence)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to create sequence at path: %s"), *AssetPath));
    }

    // Initialize movie scene
    UMovieScene* MovieScene = Sequence->GetMovieScene();
    if (!MovieScene)
    {
        return ArtifexNexusJson::MakeError(TEXT("Failed to initialize MovieScene for sequence"));
    }

    // Set default playback range (Start=0, Duration=3000 frames)
    MovieScene->SetPlaybackRange(FFrameNumber(0), 3000);

    UE_LOG(LogArtifexNexusAPI, Log, TEXT("Successfully created Level Sequence: %s"), *AssetPath);
    {
        auto _obj = ArtifexNexusJson::MakeSuccess();
        _obj->SetStringField(TEXT("data"), AssetPath);
        return ArtifexNexusJson::ToString(_obj);
    }
}

FString USequencerAPI::GetSequenceInfo(const FString& AssetPath)
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("GetSequenceInfo: %s"), *AssetPath);

    ULevelSequence* Sequence = LoadOrCreateSequence(AssetPath, false);
    if (!Sequence)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to load sequence: %s"), *AssetPath));
    }

    UMovieScene* MovieScene = Sequence->GetMovieScene();
    if (!MovieScene)
    {
        return ArtifexNexusJson::MakeError(TEXT("Sequence has no MovieScene"));
    }

    TSharedPtr<FJsonObject> InfoJson = MakeShareable(new FJsonObject);
    InfoJson->SetBoolField(TEXT("success"), true);

    // Basic info
    InfoJson->SetStringField(TEXT("path"), AssetPath);
    InfoJson->SetNumberField(TEXT("duration"), (double)(MovieScene->GetPlaybackRange().GetUpperBoundValue().Value - MovieScene->GetPlaybackRange().GetLowerBoundValue().Value));
    InfoJson->SetNumberField(TEXT("startFrame"), MovieScene->GetPlaybackRange().GetLowerBoundValue().Value);
    InfoJson->SetNumberField(TEXT("endFrame"), MovieScene->GetPlaybackRange().GetUpperBoundValue().Value);

    // Track info
    TArray<TSharedPtr<FJsonValue>> TracksArray;
    const TArray<UMovieSceneTrack*>& Tracks = MovieScene->GetTracks();
    for (UMovieSceneTrack* Track : Tracks)
    {
        if (!Track) continue;

        TSharedPtr<FJsonObject> TrackJson = MakeShareable(new FJsonObject);
        TrackJson->SetStringField(TEXT("name"), Track->GetClass()->GetName());
        TrackJson->SetStringField(TEXT("displayName"), Track->GetDisplayName().ToString());
        TrackJson->SetNumberField(TEXT("sectionCount"), Track->GetAllSections().Num());

        TracksArray.Add(MakeShareable(new FJsonValueObject(TrackJson)));
    }
    InfoJson->SetArrayField(TEXT("tracks"), TracksArray);

    // Binding info
    TArray<TSharedPtr<FJsonValue>> BindingsArray;
    const TArray<FMovieSceneBinding>& Bindings = MovieScene->GetBindings();
    for (const FMovieSceneBinding& Binding : Bindings)
    {
        TSharedPtr<FJsonObject> BindingJson = MakeShareable(new FJsonObject);
        BindingJson->SetStringField(TEXT("id"), Binding.GetObjectGuid().ToString());
        BindingJson->SetStringField(TEXT("name"), Binding.GetName());
        BindingJson->SetNumberField(TEXT("trackCount"), Binding.GetTracks().Num());

        BindingsArray.Add(MakeShareable(new FJsonValueObject(BindingJson)));
    }
    InfoJson->SetArrayField(TEXT("bindings"), BindingsArray);

    return ArtifexNexusJson::ToString(InfoJson);
}

FString USequencerAPI::AddTrack(const FString& SequencePath, const FString& TrackType, const FString& ActorName, const FString& PropertyPath)
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("AddTrack: %s, Type: %s, Actor: %s"), *SequencePath, *TrackType, *ActorName);

    ULevelSequence* Sequence = LoadOrCreateSequence(SequencePath, false);
    if (!Sequence)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to load sequence: %s"), *SequencePath));
    }

    UMovieScene* MovieScene = Sequence->GetMovieScene();
    if (!MovieScene)
    {
        return ArtifexNexusJson::MakeError(TEXT("Sequence has no MovieScene"));
    }

    UMovieSceneTrack* NewTrack = nullptr;

    if (TrackType == TEXT("Transform"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneTransformTrack>();
    }
    else if (TrackType == TEXT("Float"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneFloatTrack>();
    }
    else if (TrackType == TEXT("Bool"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneBoolTrack>();
    }
    else if (TrackType == TEXT("Audio"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneAudioTrack>();
    }
    else if (TrackType == TEXT("Event"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneEventTrack>();
    }
    else if (TrackType == TEXT("SkeletalAnimation"))
    {
        NewTrack = MovieScene->AddTrack<UMovieSceneSkeletalAnimationTrack>();
    }
    else
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Unsupported track type: %s"), *TrackType));
    }

    if (!NewTrack)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to create track of type: %s"), *TrackType));
    }

    // Track display name is read-only in UE 5.7, derived from track class

    Sequence->MarkPackageDirty();
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("Successfully added track: %s"), *TrackType);
    
    {
        auto _obj = ArtifexNexusJson::MakeSuccess();
        _obj->SetStringField(TEXT("data"), FString::Printf(TEXT("Added %s track"), *TrackType));
        return ArtifexNexusJson::ToString(_obj);
    }
}

FString USequencerAPI::AddKeyframe(const FString& SequencePath, const FString& TrackIdentifier, float Time, const FString& ValueJson)
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("AddKeyframe: %s, Track: %s, Time: %f"), *SequencePath, *TrackIdentifier, Time);

    ULevelSequence* Sequence = LoadOrCreateSequence(SequencePath, false);
    if (!Sequence)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to load sequence: %s"), *SequencePath));
    }

    UMovieScene* MovieScene = Sequence->GetMovieScene();
    if (!MovieScene)
    {
        return ArtifexNexusJson::MakeError(TEXT("Sequence has no MovieScene"));
    }

    // Parse track identifier - for now, assume it's a track index
    int32 TrackIndex = FCString::Atoi(*TrackIdentifier);
    const TArray<UMovieSceneTrack*>& AllTracks = MovieScene->GetTracks();
    
    if (TrackIndex < 0 || TrackIndex >= AllTracks.Num())
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Invalid track identifier: %s"), *TrackIdentifier));
    }

    UMovieSceneTrack* Track = AllTracks[TrackIndex];
    if (!Track)
    {
        return ArtifexNexusJson::MakeError(TEXT("Track is null"));
    }

    // Convert time to frame number
    FFrameNumber FrameNumber = MovieScene->GetTickResolution().AsFrameNumber(Time);

    // Handle different track types
    if (UMovieSceneFloatTrack* FloatTrack = Cast<UMovieSceneFloatTrack>(Track))
    {
        bool bSectionAdded = false;
        UMovieSceneFloatSection* Section = Cast<UMovieSceneFloatSection>(FloatTrack->FindOrAddSection(FrameNumber, bSectionAdded));
        if (Section)
        {
            float Value = FCString::Atof(*ValueJson);
            Section->GetChannel().AddCubicKey(FrameNumber, Value);
            Section->SetRange(TRange<FFrameNumber>::All());
        }
    }
    else if (UMovieSceneBoolTrack* BoolTrack = Cast<UMovieSceneBoolTrack>(Track))
    {
        bool bSectionAdded = false;
        UMovieSceneBoolSection* Section = Cast<UMovieSceneBoolSection>(BoolTrack->FindOrAddSection(FrameNumber, bSectionAdded));
        if (Section)
        {
            bool bValue = ValueJson.ToBool();
            TArray<FFrameNumber> Times = { FrameNumber };
            TArray<bool> Values = { bValue };
            Section->GetChannel().AddKeys(Times, Values);
            Section->SetRange(TRange<FFrameNumber>::All());
        }
    }
    else
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Keyframe addition not implemented for track type: %s"), *Track->GetClass()->GetName()));
    }

    Sequence->MarkPackageDirty();
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("Successfully added keyframe at time: %f"), Time);
    
    {
        auto _obj = ArtifexNexusJson::MakeSuccess();
        _obj->SetStringField(TEXT("data"), TEXT("Keyframe added"));
        return ArtifexNexusJson::ToString(_obj);
    }
}

FString USequencerAPI::SetPlaybackRange(const FString& SequencePath, float StartTime, float EndTime)
{
    UE_LOG(LogArtifexNexusAPI, Log, TEXT("SetPlaybackRange: %s, Start: %f, End: %f"), *SequencePath, StartTime, EndTime);

    ULevelSequence* Sequence = LoadOrCreateSequence(SequencePath, false);
    if (!Sequence)
    {
        return ArtifexNexusJson::MakeError(FString::Printf(TEXT("Failed to load sequence: %s"), *SequencePath));
    }

    UMovieScene* MovieScene = Sequence->GetMovieScene();
    if (!MovieScene)
    {
        return ArtifexNexusJson::MakeError(TEXT("Sequence has no MovieScene"));
    }

    if (StartTime >= EndTime)
    {
        return ArtifexNexusJson::MakeError(TEXT("StartTime must be less than EndTime"));
    }

    // Convert time to frame numbers
    FFrameRate TickResolution = MovieScene->GetTickResolution();
    FFrameNumber StartFrame = TickResolution.AsFrameNumber(StartTime);
    FFrameNumber EndFrame = TickResolution.AsFrameNumber(EndTime);

    MovieScene->SetPlaybackRange(StartFrame, (EndFrame - StartFrame).Value);
    Sequence->MarkPackageDirty();

    UE_LOG(LogArtifexNexusAPI, Log, TEXT("Successfully set playback range: %f - %f"), StartTime, EndTime);
    {
        auto _obj = ArtifexNexusJson::MakeSuccess();
        _obj->SetStringField(TEXT("data"), FString::Printf(TEXT("Playback range set: %f - %f"), StartTime, EndTime));
        return ArtifexNexusJson::ToString(_obj);
    }
}